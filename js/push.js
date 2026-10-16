// Web-Push an-/abmelden. Die Subscription landet in push_subscriptions; die
// Edge Function "push" schickt von dort aus.
import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from '../tournament-app/js/config.js';

function b64ToUint8(b64){
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function pushSupported(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function needsInstallForPush(){
  // iOS kann Push nur in der installierten App (Home-Bildschirm)
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

async function registration(){
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

export async function pushStatus(){
  if(!pushSupported()) return 'unsupported';
  if(Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(userId){
  if(!pushSupported()) throw new Error('Dieses Gerät/dieser Browser unterstützt keine Push-Nachrichten.');
  try{ localStorage.removeItem('sg-push-off'); }catch{}
  const perm = await Notification.requestPermission();
  if(perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if(!sub){
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' });
  if(error) throw error;
}

// Push ist standardmaessig AN: ist die Erlaubnis schon da, wird das Geraet
// still (neu) registriert. Nur wer im Profil bewusst ausschaltet, bleibt aus.
export const pushOptedOut = () => { try{ return localStorage.getItem('sg-push-off') === '1'; }catch{ return false; } };

export async function ensurePush(userId){
  if(!pushSupported() || needsInstallForPush() || pushOptedOut()) return 'skip';
  if(Notification.permission === 'granted'){
    if(sessionStorage.getItem('sg-push-ok')) return 'on';
    await enablePush(userId);
    sessionStorage.setItem('sg-push-ok', '1');
    return 'on';
  }
  return Notification.permission;      // 'default' -> nachfragen, 'denied' -> nichts
}

export async function disablePush(optOut = true){
  try{ if(optOut) localStorage.setItem('sg-push-off', '1'); }catch{}
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if(sub){
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}
