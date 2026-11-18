#!/bin/bash
# E2E verifikasi layar penuh MOBO / UPS / Peta Laut / Peta ONC.
# Ekspektasi baru (permintaan pengguna):
#  - MOBO & UPS: layar penuh HANYA menampilkan lembar + vektor (panel
#    penghitungan disembunyikan), papan memenuhi viewport, bisa zoom in/out
#    (tombol + roda mouse) dan digeser (drag pan), ada tombol Keluar.
#  - Peta Laut: tombol Layar Penuh melayang DI ATAS peta; layar penuh hanya
#    menampilkan peta + fitur + vektor (header/alat/legenda disembunyikan).
# Masuk FS: klik mouse CDP asli (butuh user activation).
# Keluar FS: klik tombol "Keluar" + fallback document.exitFullscreen().
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

fs_id() {
  sleep 2
  $AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'FS NULL (FAIL)'; return 'FS OK: '+(el.querySelector('[data-slot=\"card-title\"]')?.textContent?.trim().slice(0,50) || el.className.slice(0,60)); })()"
}

# Pemeriksaan "hanya lembar": elemen panel $2 (di dalam $1) TIDAK boleh terlihat,
# dan svg utama ($3, aria-label) harus memenuhi viewport.
fs_only_chart() {
  $AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'FAIL: no FS'; const p=[...el.querySelectorAll('$1')].find(n=>n.textContent.includes('$2')); if(p && p.getBoundingClientRect().width>20 && getComputedStyle(p).display!=='none') return 'FAIL: panel \"$2\" masih terlihat'; const svg=el.querySelector('svg[aria-label=\"$3\"]'); const r=svg?svg.getBoundingClientRect():{width:0,height:0}; const ok=svg && r.width>=window.innerWidth*0.9 && r.height>=window.innerHeight*0.9; return (ok?'OK: ':'FAIL: svg ')+Math.round(r.width)+'x'+Math.round(r.height)+' vs viewport '+window.innerWidth+'x'+window.innerHeight; })()"
}

fs_peta_only_map() {
  $AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'FAIL: no FS'; const tb=[...el.querySelectorAll('div')].find(n=>n.getAttribute('aria-label')==='Alat Peta Worksheet 1'); if(tb && tb.getBoundingClientRect().height>5 && getComputedStyle(tb).display!=='none') return 'FAIL: toolbar masih terlihat'; const lg=[...el.querySelectorAll('strong')].find(n=>n.textContent.trim()==='Legenda:'); if(lg && lg.getBoundingClientRect().width>5 && getComputedStyle(lg).display!=='none') return 'FAIL: legenda masih terlihat'; const m=el.querySelector('.seamap-map'); if(!m) return 'FAIL: peta tidak ada'; const r=m.getBoundingClientRect(); const ok=r.height>=window.innerHeight*0.9 && r.width>=window.innerWidth*0.95; return (ok?'OK: ':'FAIL: peta ')+Math.round(r.width)+'x'+Math.round(r.height)+' vs viewport '+window.innerWidth+'x'+window.innerHeight; })()"
}

fs_zoom_read() {
  $AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'noFS'; const spans=[...el.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>/^\\d+%$/.test(t)); return spans.join(',') || 'no-%-span'; })()"
}

fs_exit() {
  # 1) klik tombol "Keluar" yang TERLIHAT di dalam elemen fullscreen (uji tombol
  #    aplikasi; abaikan tombol header yang display:none)
  click_js "document.fullscreenElement ? [...document.fullscreenElement.querySelectorAll('button[title=\"Keluar layar penuh (Esc)\"]')].find(b=>b.getBoundingClientRect().width>5) : null" "keluar"
  sleep 1.2
  $AB eval "document.fullscreenElement ? 'FS STILL ACTIVE after Keluar-btn' : 'FS EXITED via tombol Keluar'"
  # 2) fallback programatik
  $AB eval "(() => { if (document.fullscreenElement) { document.exitFullscreen(); return 'fallback exit sent'; } return 'already exited'; })()"
  sleep 1.2
  $AB eval "document.fullscreenElement ? 'FS STILL ACTIVE (FAIL)' : 'FS EXITED OK'"
}

echo "=== 1. PETA LAUT: tombol melayang di atas peta ==="
$AB eval "(() => { const b=[...document.querySelectorAll('aside button[title=\"Tampilkan layar penuh\"]')].find(x=>x.className.includes('1300')); if(!b) return 'FLOATING BTN NOT FOUND'; const r=b.getBoundingClientRect(); return 'floating btn @ '+Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'x'+Math.round(r.height); })()"
click_js "[...document.querySelectorAll('aside button[title=\"Tampilkan layar penuh\"]')].find(x=>x.className.includes('1300'))" "peta laut floating"
fs_id
fs_peta_only_map
$AB screenshot /tmp/render/fs_1_peta_laut.png
fs_exit
sleep 1

echo "=== 2. UPS: fullscreen hanya lembar + zoom + pan ==="
tab_click "UPS Plotter"
sleep 5
click_js "[...document.querySelectorAll('div.fs-target button[title=\"Tampilkan layar penuh\"]')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Mid-Latitude') && x.getBoundingClientRect().width>5)" "ups"
fs_id
fs_only_chart 'h4' 'Plot titik dan rute UPS' 'Universal Plotting Sheet VP-OS asli dengan vektor hasil worksheet'
echo "-- zoom tombol di layar penuh:"
$AB eval "(() => { const b=document.fullscreenElement?.querySelector('button[aria-label=\"Perbesar lembar UPS\"]'); if(!b) return 'ZOOM+ NOT FOUND in FS'; b.click(); b.click(); return 'zoom+ 2x'; })()"
sleep 0.8
echo "zoom after buttons: $(fs_zoom_read)"
echo "-- pan (drag):"
$AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'noFS'; const w=el.querySelector('.sheet-zoom-wrap'); if(!w) return 'no wrap'; return 'transform before: '+w.style.transform; })()"
PAIR=$($AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'null'; const r=el.getBoundingClientRect(); return Math.round(r.width/2)+','+Math.round(r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
if [[ "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then
  $AB mouse move "${PAIR%,*}" "${PAIR#*,}"
  $AB mouse down left
  $AB mouse move $(( ${PAIR%,*} + 180 )) $(( ${PAIR#*,} + 120 ))
  $AB mouse up left
  sleep 0.6
fi
$AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'noFS'; const w=el.querySelector('.sheet-zoom-wrap'); if(!w) return 'no wrap'; return 'transform after drag: '+w.style.transform; })()"
echo "-- zoom roda mouse di layar penuh (turun = perkecil):"
$AB mouse wheel 600
sleep 0.8
echo "zoom after wheel-down: $(fs_zoom_read)"
$AB mouse wheel -900
sleep 0.8
echo "zoom after wheel-up: $(fs_zoom_read)"
$AB screenshot /tmp/render/fs_2_ups.png
fs_exit
sleep 1

echo "=== 3. MOBO (AWA tab): fullscreen hanya papan + zoom + pan ==="
tab_click "1. AWA + MoBo"
sleep 5
click_js "[...document.querySelectorAll('div.fs-target button[title=\"Tampilkan layar penuh\"]')].find(x=>x.closest('[data-slot=\"card\"]')?.textContent.includes('Papan Manuver') && x.getBoundingClientRect().width>5)" "mobo"
fs_id
fs_only_chart 'h4' 'Daftar Vektor (Saling Nyambung)' 'Maneuvering Board DMAHTC 5090 asli dengan vektor plotting'
echo "-- zoom tombol di layar penuh:"
$AB eval "(() => { const b=document.fullscreenElement?.querySelector('button[aria-label=\"Perbesar papan manuver\"]'); if(!b) return 'ZOOM+ NOT FOUND in FS'; b.click(); b.click(); return 'zoom+ 2x'; })()"
sleep 0.8
echo "zoom after buttons: $(fs_zoom_read)"
echo "-- pan (drag):"
$AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'noFS'; const w=el.querySelector('.sheet-zoom-wrap'); if(!w) return 'no wrap'; return 'transform before: '+w.style.transform; })()"
PAIR=$($AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'null'; const r=el.getBoundingClientRect(); return Math.round(r.width/2)+','+Math.round(r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
if [[ "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then
  $AB mouse move "${PAIR%,*}" "${PAIR#*,}"
  $AB mouse down left
  $AB mouse move $(( ${PAIR%,*} - 150 )) $(( ${PAIR#*,} + 100 ))
  $AB mouse up left
  sleep 0.6
fi
$AB eval "(() => { const el=document.fullscreenElement; if(!el) return 'noFS'; const w=el.querySelector('.sheet-zoom-wrap'); if(!w) return 'no wrap'; return 'transform after drag: '+w.style.transform; })()"
echo "-- zoom roda mouse di layar penuh (naik = perbesar):"
$AB mouse wheel -700
sleep 0.8
echo "zoom after wheel-up: $(fs_zoom_read)"
$AB mouse wheel 500
sleep 0.8
echo "zoom after wheel-down: $(fs_zoom_read)"
$AB screenshot /tmp/render/fs_3_mobo.png
fs_exit
sleep 1

echo "=== 4. PETA ONC (WS 4 tab): tombol Layar Penuh ==="
tab_click "WS 4 (Radius)"
sleep 7
click_js "[...document.querySelectorAll('section h3')].filter(h=>h.textContent.includes('Peta udara Worksheet 4')).map(h=>h.closest('section')?.querySelector('button[title=\"Tampilkan layar penuh\"]')).find(b=>b && b.getBoundingClientRect().width>5)" "onc"
fs_id
$AB screenshot /tmp/render/fs_4_onc.png
fs_exit

echo "=== page errors ==="
$AB errors || true

echo "=== dev log tail ==="
tail -5 /tmp/nextdev.log

$AB close
kill "$DEVPID" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
echo "E2E DONE"
