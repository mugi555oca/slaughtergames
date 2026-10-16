# Laedt Turnierfotos aus assets/games/sgN/ in den privaten Bucket "gallery"
# und traegt sie in gallery_photos ein (SQL-Datei zum Ausfuehren mit
# `supabase db query --linked -f gallery_photos.sql`).
#
#   SUPABASE_SERVICE_ROLE_KEY=... python tournament-app/tests/upload_gallery.py assets/games
#
# Den Service-Role-Key nie committen oder teilen (siehe HANDOVER.md).
import io, os, sys, urllib.request
from PIL import Image, ImageOps

key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
URL = 'https://shzyksgqawknysbvhlwn.supabase.co/storage/v1/object/gallery/'
root = sys.argv[1]

def up(path, data):
    req = urllib.request.Request(URL + path, data=data, method='POST', headers={
        'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    urllib.request.urlopen(req).read()

def jpg(im, side, q):
    im = im.copy(); im.thumbnail((side, side), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True, progressive=True)
    return b.getvalue(), im.size

rows = []
for album in sorted(os.listdir(root)):
    files = sorted(f for f in os.listdir(os.path.join(root, album)) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')))
    for i, f in enumerate(files, 1):
        im = ImageOps.exif_transpose(Image.open(os.path.join(root, album, f))).convert('RGB')
        full, (w, h) = jpg(im, 2000, 84)
        thumb, _ = jpg(im, 480, 78)
        name = f'legacy_{i:03d}.jpg'
        up(f'{album}/{name}', full); up(f'{album}/thumbs/{name}', thumb)
        rows.append(f"('{album}','{album}/{name}','{album}/thumbs/{name}',{w},{h},{i},null)")
        print(album, name, flush=True)

with open('gallery_photos.sql', 'w') as out:
    out.write('insert into public.gallery_photos(album,path,thumb_path,width,height,sort_key,uploaded_by) values\n')
    out.write(',\n'.join(rows) + '\non conflict (path) do nothing;\n')
print(len(rows), 'Fotos hochgeladen -> gallery_photos.sql ausfuehren')
