#!/bin/bash
# E2E verifikasi tombol Layar Penuh (Peta Laut, UPS, MOBO, ONC) + zoom UPS.
# Masuk FS: klik mouse CDP asli (butuh user activation).
# Keluar FS: klik tombol "Keluar" + fallback document.exitFullscreen()
# (Escape headless CDP tidak menutup fullscreen).
set -u
cd /home/z/my-project
mkdir -p /tmp/render

command -v agent-browser >/dev/null 2>&1 || { echo "agent-browser NOT INSTALLED"; exit 1; }

rm -f /tmp/nextdev.log
setsid bun run dev > /tmp/nextdev.log 2>&1 &
DEVPID=$!
echo "dev server pid=$DEVPID"

READY=0
for i in $(seq 1 90); do
  if curl -s -o /dev/null -m 3 http://localhost:3000; then READY=1; echo "SERVER READY (${i}s)"; break; fi
  sleep 1
done
[ "$READY" = "1" ] || { echo "SERVER FAILED"; tail -40 /tmp/nextdev.log; exit 1; }
sleep 3

AB="agent-browser"

$AB set viewport 1600 900
$AB open http://localhost:3000
$AB wait --load networkidle 2>/dev/null || true
sleep 6

click_js() {
  # $1 = ekspresi JS mengembalikan elemen; $2 = label. Gagal bila tidak ada/tersembunyi.
  local ST=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); if(r.width<5||r.height<5) return 'hidden'; b.scrollIntoView({block:'center'}); return 'ok'; })()" 2>/dev/null | tr -d '"' | tail -1)
  if [ "$ST" = "null" ] || [ "$ST" = "hidden" ]; then echo "CLICK TARGET NOT FOUND/$ST: $2"; return 1; fi
  sleep 0.6
  local PAIR=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
  if [[ ! "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then echo "CLICK TARGET NOT FOUND/$PAIR: $2"; return 1; fi
  local CX="${PAIR%,*}"; local CY="${PAIR#*,}"
  echo "click ($2) @ $CX,$CY"
  $AB mouse move "$CX" "$CY"
  sleep 0.3
  $AB mouse down left
  $AB mouse up left
}

tab_click() { click_js "[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('$1'))" "tab $1"; }

fs_check() {
  sleep 2
  $AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'FS NULL (FAIL)'; const t=el.querySelector('[data-slot=\"card-title\"]')?.textContent?.trim() || el.querySelector('h3')?.textContent?.trim() || el.className; return 'FS OK: '+t.slice(0,60); })()"
}
fs_exit() {
  # 1) klik tombol "Keluar" di dalam elemen fullscreen (uji tombol aplikasi)
  click_js "document.fullscreenElement?.querySelector('button[title=\"Keluar layar penuh (Esc)\"]')" "keluar"
  sleep 1.2
  $AB eval "document.fullscreenElement ? 'FS STILL ACTIVE after Keluar-btn' : 'FS EXITED via tombol Keluar'"
  # 2) fallback programatik
  $AB eval "(() => { if (document.fullscreenElement) { document.exitFullscreen(); return 'fallback exit sent'; } return 'already exited'; })()"
  sleep 1.2
  $AB eval "document.fullscreenElement ? 'FS STILL ACTIVE (FAIL)' : 'FS EXITED OK'"
}

echo "=== 1. PETA LAUT: tombol Layar Penuh ==="
click_js "[...document.querySelectorAll('aside button[title=\"Tampilkan layar penuh\"]')][0]" "peta laut"
fs_check
$AB screenshot /tmp/render/fs_1_peta_laut.png
fs_exit

echo "=== 2. UPS: fullscreen + zoom in/out ==="
tab_click "UPS Plotter"
sleep 5
$AB eval "(() => { const plus=[...document.querySelectorAll('button[aria-label=\"Perbesar lembar UPS\"]')][0]; if(!plus) return 'ZOOM+ BTN NOT FOUND'; plus.click(); plus.click(); plus.click(); return 'zoom+ clicked 3x'; })()"
sleep 0.8
$AB eval "(() => { const card=[...document.querySelectorAll('[data-slot=\"card\"]')].find(c=>c.textContent.includes('Mid-Latitude') && c.getBoundingClientRect().height>50); if(!card) return 'UPS CARD NOT FOUND'; const pcts=[...card.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>/^\\d+%$/.test(t)); return 'zoom display: '+pcts.join(','); })()"
$AB eval "(() => { const d=[...document.querySelectorAll('div.cursor-grab')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Mid-Latitude') && x.getBoundingClientRect().height>50); if(!d) return 'null'; d.scrollIntoView({block:'center'}); return 'scrolled'; })()" >/dev/null 2>&1
sleep 0.6
PAIR=$($AB eval "(() => { const d=[...document.querySelectorAll('div.cursor-grab')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Mid-Latitude')); if(!d) return 'null'; const r=d.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
echo "sheet center: $PAIR"
if [[ "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then
  $AB mouse move "${PAIR%,*}" "${PAIR#*,}"
  $AB mouse wheel 400
  sleep 0.8
  $AB eval "(() => { const card=[...document.querySelectorAll('[data-slot=\"card\"]')].find(c=>c.textContent.includes('Mid-Latitude')); const pcts=[...card.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>/^\\d+%$/.test(t)); return 'after wheel-down (perkecil): '+pcts.join(','); })()"
  $AB mouse wheel -800
  sleep 0.8
  $AB eval "(() => { const card=[...document.querySelectorAll('[data-slot=\"card\"]')].find(c=>c.textContent.includes('Mid-Latitude')); const pcts=[...card.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>/^\\d+%$/.test(t)); return 'after wheel-up (perbesar): '+pcts.join(','); })()"
fi
click_js "[...document.querySelectorAll('div.fs-target button[title=\"Tampilkan layar penuh\"]')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Mid-Latitude') && x.getBoundingClientRect().width>5)" "ups"
fs_check
$AB screenshot /tmp/render/fs_2_ups.png
fs_exit

echo "=== 3. MOBO (AWA tab): tombol Layar Penuh ==="
tab_click "1. AWA + MoBo"
sleep 5
click_js "[...document.querySelectorAll('div.fs-target button[title=\"Tampilkan layar penuh\"]')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Papan Manuver') && x.getBoundingClientRect().width>5)" "mobo"
fs_check
$AB screenshot /tmp/render/fs_3_mobo.png
fs_exit

echo "=== 4. PETA ONC (WS 4 tab): tombol Layar Penuh ==="
tab_click "WS 4 (Radius)"
sleep 7
click_js "[...document.querySelectorAll('section h3')].filter(h=>h.textContent.includes('Peta udara Worksheet 4')).map(h=>h.closest('section')?.querySelector('button[title=\"Tampilkan layar penuh\"]')).find(b=>b && b.getBoundingClientRect().width>5)" "onc"
fs_check
$AB screenshot /tmp/render/fs_4_onc.png
fs_exit

echo "=== page errors ==="
$AB errors || true

$AB close
kill "$DEVPID" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
echo "E2E DONE"
