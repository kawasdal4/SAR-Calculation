#!/bin/bash
# Verifikasi visual & fungsional perbaikan sesi ini:
#  1) WS 1 default x/y = 0.1 (Table J-1 GPS) + fs default 1.1
#  2) Search plan A default & tersinkron (AWA/ASW/ADW)
#  3) Figure I-12 Search = First (WS 2/WS 8), Search Number = 1st (WS 3) + sinkron fs ↔ searchNumber
#  4) Upload peta (TempMapFile self-healing) via POST /api/maps/temp
#  5) Tombol layar penuh peta darat (WS 4)
set -u
cd /home/z/my-project
mkdir -p /tmp/render

rm -f /tmp/nextdev6.log
setsid bun run dev > /tmp/nextdev6.log 2>&1 &
DEVPID=$!
for i in $(seq 1 180); do
  curl -s -o /dev/null -m 3 http://localhost:3000 && { echo "READY (${i}s)"; break; }
  sleep 1
done
sleep 3

# --- 4) Upload peta langsung ke API (bukti tabel TempMapFile dibuat otomatis)
python3 - <<'PY'
import struct, zlib
def png(path, w=4, h=4):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    raw = b''.join(b'\x00' + b'\x00\xff\x00' * w for _ in range(h))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend)
png('/tmp/render/test-map.png')
print('png created')
PY
UP=$(curl -s -X POST http://localhost:3000/api/maps/temp -F "file=@/tmp/render/test-map.png;type=image/png")
echo "UPLOAD_RESP=$UP" | head -c 400; echo
echo "$UP" > /tmp/render/upload.json

AB="agent-browser"
$AB set viewport 1440 900
$AB open http://localhost:3000
$AB wait --load networkidle 2>/dev/null || true
sleep 6
P=$($AB eval "window.location.pathname" 2>/dev/null | tr -d '"' | tail -1)
echo "pathname=$P"
if [ "$P" != "/" ]; then
  $AB eval "(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const a = document.querySelector('input[placeholder=\"Username / Email / NIP\"]');
    const b = document.querySelector('input[placeholder=\"Password\"]');
    if (a) { setter.call(a, 'developer'); a.dispatchEvent(new Event('input', { bubbles: true })); }
    if (b) { setter.call(b, 'dev12345'); b.dispatchEvent(new Event('input', { bubbles: true })); }
    return 'filled';
  })()" >/dev/null 2>&1
  sleep 0.5
  PAIR=$($AB eval "(() => { const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Masuk')); const r=btn.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
  $AB mouse move $(echo "$PAIR" | cut -d, -f1) $(echo "$PAIR" | cut -d, -f2); $AB mouse down left; $AB mouse up left
  for i in $(seq 1 60); do
    P=$($AB eval "window.location.pathname" 2>/dev/null | tr -d '"' | tail -1)
    [ "$P" = "/" ] && break
    sleep 1
  done
  echo "after login pathname=$P"
fi
for i in $(seq 1 60); do
  T=$($AB eval "[...document.querySelectorAll('[role=\"tab\"]')].length" 2>/dev/null | tr -d '"' | tail -1)
  [ "${T:-0}" -ge 3 ] 2>/dev/null && break
  sleep 1
done
sleep 2

klik_tab () {
  PAIR=$($AB eval "(() => { const t=document.querySelector('[data-tab-value=\"$1\"]'); if(!t) return 'NA'; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
  if [ "$PAIR" != "NA" ]; then
    $AB mouse move $(echo "$PAIR" | cut -d, -f1) $(echo "$PAIR" | cut -d, -f2); sleep 0.3; $AB mouse down left; $AB mouse up left
    sleep 2.5
  fi
}

# --- 1) Worksheet 1: x/y default 0.1 & fs 1.1
klik_tab ws1
sleep 2
$AB eval "(() => {
  const rows = [...document.querySelectorAll('td')];
  const find = (label) => { const td = rows.find(c => c.textContent.trim().startsWith(label)); if (!td) return null; return td.parentElement.textContent.replace(/\s+/g,' '); };
  return JSON.stringify({
    x: (find('Distress craft error (x)')||'X?').slice(0,120),
    y: (find('Search craft error (y)')||'Y?').slice(0,120),
    target: (find('Search target (description)')||'?').slice(0,90),
    fs: (find('Safety factor (circle) (fs)')||'?').slice(0,80),
  });
})()" 2>/dev/null
$AB eval "(() => { const host=document.querySelector('[role=tabpanel]'); host?.scrollIntoView({block:'start'}); window.scrollTo(0,0); return 'ok'; })()" >/dev/null 2>&1
$AB screenshot /tmp/render/fix_ws1.png

# --- 2) Search plan A di AWA / ASW / ADW
klik_tab awa
sleep 1.5
$AB eval "(() => {
  const span=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Search plan:');
  if (!span) return 'AWA: plan label tidak ada';
  const box=span.parentElement;
  const active=box.querySelector('.ring-2, .ring-1');
  return 'AWA plan aktif=' + (active?.textContent?.trim() || '?');
})()" 2>/dev/null
$AB screenshot /tmp/render/fix_awa.png

klik_tab asw
sleep 1.5
$AB eval "(() => {
  const span=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Search plan:');
  if (!span) return 'ASW: plan label tidak ada';
  const active=span.parentElement.querySelector('.ring-2, .ring-1');
  return 'ASW plan aktif=' + (active?.textContent?.trim() || '?');
})()" 2>/dev/null

klik_tab aero
sleep 1.5
$AB eval "(() => {
  const span=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Search plan');
  if (!span) return 'ADW: plan label tidak ada';
  const active=span.parentElement.querySelector('.ring-1');
  return 'ADW plan aktif=' + (active?.textContent?.trim() || '?');
})()" 2>/dev/null

# --- 3) WS 2 / WS 8 / WS 3: default First/1st + sinkron dari fs WS 1
klik_tab ws2
sleep 1.5
$AB eval "(() => {
  const sels=[...document.querySelectorAll('select')];
  const sel=sels.find(s=>[...s.options].some(o=>o.textContent==='First'));
  if (!sel) return 'WS2: select Figure I-12 tidak ditemukan';
  return 'WS2 Search=' + sel.options[sel.selectedIndex]?.textContent + ' (value=' + sel.value + ')';
})()" 2>/dev/null
$AB screenshot /tmp/render/fix_ws2.png

klik_tab ws8
sleep 1.5
$AB eval "(() => {
  const sels=[...document.querySelectorAll('select')];
  const sel=sels.find(s=>[...s.options].some(o=>o.textContent==='First'));
  if (!sel) return 'WS8: select tidak ditemukan';
  return 'WS8 Search=' + sel.options[sel.selectedIndex]?.textContent + ' (value=' + sel.value + ')';
})()" 2>/dev/null

# Sinkron: klik fs 1.6 di WS 1 → WS 2 harus jadi Second
klik_tab ws1
sleep 1.5
$AB eval "(() => {
  const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1.6' && b.closest('td'));
  if (!btn) return 'tombol fs 1.6 tidak ada';
  btn.click();
  return 'klik fs 1.6 → ' + (btn.className.includes('bg-blue-600') ? 'aktif' : 'belum');
})()" 2>/dev/null
klik_tab ws2
sleep 1.5
$AB eval "(() => {
  const sels=[...document.querySelectorAll('select')];
  const sel=sels.find(s=>[...s.options].some(o=>o.textContent==='First'));
  if (!sel) return 'WS2: select tidak ditemukan';
  return 'WS2 Search SETELAH fs 1.6 = ' + sel.options[sel.selectedIndex]?.textContent + ' (value=' + sel.value + ') expected Second/2';
})()" 2>/dev/null
klik_tab ws1
sleep 1
$AB eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='1.1' && x.closest('td')); b?.click(); return 'fs kembali 1.1'; })()" >/dev/null 2>&1

# --- 3b) WS 3: Search Number default 1st Search
klik_tab ws3
sleep 1.5
$AB eval "(() => {
  const sels=[...document.querySelectorAll('select')];
  const sel=sels.find(s=>[...s.options].some(o=>o.textContent==='1st Search'));
  if (!sel) return 'WS3: select Search Number tidak ditemukan';
  return 'WS3 Search Number=' + sel.options[sel.selectedIndex]?.textContent + ' (value=' + sel.value + ')';
})()" 2>/dev/null
$AB screenshot /tmp/render/fix_ws3.png

# --- 5) Layar penuh peta darat (WS 4)
klik_tab ws4
sleep 2
$AB eval "(() => {
  const btn=[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')?.includes('layar penuh') && b.closest('.land-map-root'));
  if (!btn) return 'TOMBOL LAYAR PENUH PETA DARAT TIDAK ADA';
  btn.scrollIntoView({block:'center'});
  btn.click();
  return new Promise((res) => setTimeout(() => res('fullscreenElement=' + (document.fullscreenElement ? 'AKTIF (' + (document.fullscreenElement.className||'').slice(0,40) + ')' : 'null')), 900));
})()" 2>/dev/null
sleep 1.5
$AB screenshot /tmp/render/fix_landmap_fs.png
$AB eval "(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')?.includes('Keluar layar penuh')); if (btn) { btn.click(); return 'keluar fullscreen diklik'; } return document.exitFullscreen ? 'fallback exitFullscreen' : 'tombol keluar tidak ada'; })()" 2>/dev/null
sleep 1

echo "DEV_LOG_ERRORS:"
grep -iE "error|failed to compile" /tmp/nextdev6.log | grep -v "warn" | head -10
kill $DEVPID 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
echo DONE