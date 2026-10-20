# Schreibt in jede Seite <link rel="modulepreload"> fuer ALLE Module, die sie
# braucht (rekursiv). Dann laedt der Browser alles gleichzeitig statt als
# Kette (Seite -> app.js -> supabase.js -> config.js -> CDN ...).
#
#   python tools/preload.py        # nach jeder Aenderung an import-Zeilen
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDN = 'https://cdn.jsdelivr.net/npm/'
SUPABASE_CDN = [CDN + p for p in [
    '@supabase/supabase-js@2.118.0/+esm', '@supabase/auth-js@2.118.0/+esm', '@supabase/postgrest-js@2.118.0/+esm',
    '@supabase/realtime-js@2.118.0/+esm', '@supabase/storage-js@2.118.0/+esm', '@supabase/functions-js@2.118.0/+esm',
    '@supabase/phoenix@0.4.5/+esm', 'tslib@2.8.1/+esm', 'iceberg-js@0.8.1/+esm']]
IMPORT = re.compile(r'''(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)''')
SEP = os.sep


def resolve(base, spec):
    if spec.startswith('http') or spec.startswith('/'):
        return spec
    joined = os.path.normpath(os.path.join(os.path.dirname(base.lstrip('/')), spec))
    return '/' + joined.replace(SEP, '/')


def graph(entry, seen):
    if entry in seen or entry.startswith('http'):
        return
    seen.add(entry)
    path = os.path.join(ROOT, entry.lstrip('/'))
    if not os.path.exists(path):
        return
    src = open(path, encoding='utf-8').read()
    for m in IMPORT.finditer(src):
        spec = m.group(1) or m.group(2)
        if not spec.startswith('http'):
            graph(resolve(entry, spec), seen)


for dirpath, _, files in os.walk(ROOT):
    if '.git' in dirpath:
        continue
    for f in files:
        if not f.endswith('.html'):
            continue
        p = os.path.join(dirpath, f)
        html = open(p, encoding='utf-8').read()
        entry = re.search(r'<script type="module" src="([^"]+)"', html)
        if not entry or '</head>' not in html:
            continue
        rel = '/' + os.path.relpath(p, ROOT).replace(SEP, '/')
        mods = set()
        graph(resolve(rel, entry.group(1)), mods)
        uses_sb = '/js/supabase.js' in mods
        lines = ['  <!-- preload:start (tools/preload.py) -->']
        if uses_sb:
            lines.append('  <link rel="preconnect" href="https://shzyksgqawknysbvhlwn.supabase.co" crossorigin>')
            lines.append('  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>')
        lines += [f'  <link rel="modulepreload" href="{m}">' for m in sorted(mods)]
        if uses_sb:
            lines += [f'  <link rel="modulepreload" href="{u}" crossorigin>' for u in SUPABASE_CDN]
        lines.append('  <!-- preload:end -->')
        html = re.sub(r'  <!-- preload:start.*?<!-- preload:end -->\n?', '', html, flags=re.S)
        html = html.replace('</head>', '\n'.join(lines) + '\n</head>', 1)
        open(p, 'w', encoding='utf-8', newline='\n').write(html)
        print(f'{rel}: {len(mods)} Module')
