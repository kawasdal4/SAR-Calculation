#!/bin/bash
# E2E verifikasi perbaikan penggambaran peta (permintaan pengguna):
#   1. Label titik datum di peta cukup "Datum" (bukan "Datum B: <koordinat> …")
#   2. Label teks "Worksheet 1 Search Area …" di tengah kotak DIHAPUS
#   3. Garis kotak search area digambar SOLID (bukan putus-putus)
#   4. Garis putus-putus biru "ASW (downwind)" DIHAPUS dari penggambaran
# Alur kasus sama dengan e2e_datum.sh (ASW contoh → WS 1: LKP, arus laut,
# leeway scuba, X=Y=0.1) sehingga peta penuh vektor + kotak area.
set -u
cd /home/z/my-project
mkdir -p /tmp/render

command -v agent-browser >/dev/null 2>&1 || { echo "agent-browser NOT INSTALLED"; exit 1; }

rm -f /tmp/nextdev.log
setsid bun run dev > /tmp/nextdev.log 2>&1 &
DEVPID=$!
echo "dev server pid=$DEVPID"

READY=0
for i in $(seq 1 120); do
  if curl -s -o /dev/null -m 3 http://localhost:3000; then READY=1; echo "SERVER READY (${i}s)"; break; fi
  sleep 1
done
[ "$READY" = "1" ] || { echo "SERVER FAILED"; tail -40 /tmp/nextdev.log; kill $DEVPID 2>/dev/null; exit 1; }
sleep 4

AB="agent-browser"
FAILS=0
ok()   { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; FAILS=$((FAILS+1)); }

$AB set viewport 1600 900
$AB open http://localhost:3000
$AB wait --load networkidle 2>/dev/null || true
sleep 8

click_js() {
  local ST=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); if(r.width<5||r.height<5) return 'hidden'; b.scrollIntoView({block:'center'}); return 'ok'; })()" 2>/dev/null | tr -d '"' | tail -1)
  if [ "$ST" = "null" ] || [ "$ST" = "hidden" ]; then echo "CLICK TARGET NOT FOUND/$ST: $2"; FAILS=$((FAILS+1)); return 1; fi
  sleep 0.6
  local PAIR=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
  if [[ ! "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then echo "CLICK TARGET NOT FOUND/$PAIR: $2"; FAILS=$((FAILS+1)); return 1; fi
  local CX="${PAIR%,*}"; local CY="${PAIR#*,}"
  echo "click ($2) @ $CX,$CY"
  $AB mouse move "$CX" "$CY"
  sleep 0.3
  $AB mouse down left
  $AB mouse up left
}

set_input() {
  $AB eval "(() => {
    const el = ($1);
    if (!el) return 'INPUT NOT FOUND';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '$2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set $2';
  })()" 2>/dev/null | tr -d '"' | tail -1
  sleep 0.4
}

echo "=== 1. ASW: contoh kasus + semua baris angin 270°T/15 kn ==="
tab_click() { click_js "[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('$1'))" "tab $1"; }
tab_click "3. ASW"
sleep 2
click_js "[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Muat Contoh Kasus'))" "muat contoh"
sleep 1.5
$AB eval "(() => {
  const rows = [...document.querySelectorAll('table tbody tr')].filter(tr => tr.querySelector('input[type=number]'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  let n = 0;
  for (const tr of rows) {
    const inputs = [...tr.querySelectorAll('input[type=number]')];
    if (inputs.length >= 2) {
      setter.call(inputs[0], '270');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      n++;
      setter.call(inputs[1], '15');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      n++;
    }
  }
  return 'edited ' + n + ' inputs on ' + rows.length + ' rows';
})()"
sleep 1.5

echo "=== 2. WS 1: LKP + arus laut + leeway scuba + X/Y ==="
tab_click "4. WS 1"
sleep 2.5
set_input "[...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')==='Latitude LKP' && i.getBoundingClientRect().width>5)" "-5.5" "lat LKP"
sleep 0.5
set_input "[...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')==='Longitude LKP' && i.getBoundingClientRect().width>5)" "106.0" "lng LKP"
sleep 0.5
$AB eval "(() => {
  const cards=[...document.querySelectorAll('[data-slot=card]')];
  const c=cards.find(x=>x.textContent.includes('Total Water Current (TWC)'));
  if(!c) return 'TWC CARD NOT FOUND';
  const labels=[...c.querySelectorAll('label')];
  const setL=labels.find(l=>l.textContent.includes('Sea Current Set'));
  const drL=labels.find(l=>l.textContent.includes('Sea Current Drift'));
  if(!setL||!drL) return 'LABELS NOT FOUND';
  const setI=setL.parentElement.querySelector('input[type=number]');
  const drI=drL.parentElement.querySelector('input[type=number]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(setI,'45'); setI.dispatchEvent(new Event('input',{bubbles:true}));
  setter.call(drI,'0.5'); drI.dispatchEvent(new Event('input',{bubbles:true}));
  return 'sea current set 45 / 0.5';
})()"
sleep 0.6
click_js "(() => { const c=[...document.querySelectorAll('[data-slot=card]')].find(x=>x.textContent.includes('Leeway (LW)')); const t=c?c.querySelector('[data-slot=select-trigger]'):null; return t; })()" "leeway select trigger"
sleep 1
click_js "[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('PIW – Horizontal, Scuba Suit'))" "opsi scuba"
sleep 1.2
$AB eval "(() => {
  const cards=[...document.querySelectorAll('[data-slot=card]')];
  const c=cards.find(x=>x.textContent.includes('Total Probable Error of Position (E)'));
  if(!c) return 'E CARD NOT FOUND';
  const labels=[...c.querySelectorAll('label')];
  const xL=labels.find(l=>l.textContent.startsWith('X —'));
  const yL=labels.find(l=>l.textContent.startsWith('Y —'));
  if(!xL||!yL) return 'XY LABELS NOT FOUND';
  const xI=xL.parentElement.querySelector('input[type=number]');
  const yI=yL.parentElement.querySelector('input[type=number]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(xI,'0.1'); xI.dispatchEvent(new Event('input',{bubbles:true}));
  setter.call(yI,'0.1'); yI.dispatchEvent(new Event('input',{bubbles:true}));
  return 'X=Y=0.1 set';
})()"
sleep 2

echo "=== 3. Verifikasi penggambaran peta (4 permintaan) ==="

# (1) Label datum = "Datum" persis; tidak ada lagi label "Datum B: ..."
$AB eval "(() => {
  const labels=[...document.querySelectorAll('.sar-point-label')].map(n=>n.textContent.trim());
  const datumLabels=labels.filter(l=>/^Datum$/i.test(l));
  const oldLabels=labels.filter(l=>/^Datum B/i.test(l));
  const ok = datumLabels.length>0 && oldLabels.length===0;
  return JSON.stringify({ok, datumLabels, oldLabels});
})()" > /tmp/render/labels.json 2>/dev/null
cat /tmp/render/labels.json
if rg -q 'ok\\":true' /tmp/render/labels.json; then
  ok "label datum = 'Datum' (tanpa koordinat/DTG/bearing)"
else
  bad "label datum tidak sesuai harapan"
fi

# (2) Label "Worksheet 1 Search Area …" di tengah kotak dihapus
$AB eval "(() => {
  const area=[...document.querySelectorAll('.sar-area-label')].map(n=>n.textContent.trim());
  const ws1=area.filter(l=>l.includes('Worksheet 1'));
  const corners=[...document.querySelectorAll('.sar-point-label')].map(n=>n.textContent.trim()).filter(l=>/^[A-D] · WS1$/.test(l));
  const ok = ws1.length===0 && corners.length===4;
  return JSON.stringify({ok, areaLabels: area, cornerLabels: corners});
})()" > /tmp/render/areas.json 2>/dev/null
cat /tmp/render/areas.json
if rg -q 'ok\\":true' /tmp/render/areas.json; then
  ok "label 'Worksheet 1 Search Area' dihapus; label sudut A·WS1…D·WS1 tetap ada"
else
  bad "label area / sudut tidak sesuai harapan"
fi

# (3) Kotak search area SOLID — path polygon hijau (#16a34a, ber-fill) tanpa stroke-dasharray
$AB eval "(() => {
  const map=document.querySelector('.seamap-map');
  if(!map) return JSON.stringify({ok:false, err:'MAP NOT FOUND'});
  const poly=[...map.querySelectorAll('path[stroke=\"#16a34a\"][fill=\"#16a34a\"]')];
  const dashed=poly.filter(p=>p.getAttribute('stroke-dasharray'));
  const ok = poly.length>0 && dashed.length===0;
  return JSON.stringify({ok, polygonCount: poly.length, dashedCount: dashed.length});
})()" > /tmp/render/poly.json 2>/dev/null
cat /tmp/render/poly.json
if rg -q 'ok\\":true' /tmp/render/poly.json; then
  ok "kotak search area digambar SOLID (tanpa stroke-dasharray)"
else
  bad "kotak search area masih putus-putus / tidak ditemukan"
fi

# (4) Garis putus-putus biru (#0ea5e9 ASW downwind) tidak ada lagi di peta
$AB eval "(() => {
  const map=document.querySelector('.seamap-map');
  if(!map) return JSON.stringify({ok:false, err:'MAP NOT FOUND'});
  const blue=[...map.querySelectorAll('path')].filter(p=>(p.getAttribute('stroke')||'').toLowerCase()==='#0ea5e9');
  const lineLabels=[...document.querySelectorAll('.sar-line-label-text')].map(n=>n.textContent.trim());
  const ok = blue.length===0 && !lineLabels.some(l=>l.includes('ASW'));
  return JSON.stringify({ok, bluePathCount: blue.length, hasAswLabel: lineLabels.some(l=>l.includes('ASW'))});
})()" > /tmp/render/blue.json 2>/dev/null
cat /tmp/render/blue.json
if rg -q 'ok\\":true' /tmp/render/blue.json; then
  ok "garis putus-putus biru (ASW downwind) sudah dihapus"
else
  bad "masih ada garis biru / label ASW di peta"
fi

# Vector standar tetap lengkap
$AB eval "(() => {
  const ll=[...document.querySelectorAll('.sar-line-label-text')].map(n=>n.textContent.trim());
  const want=['Arus laut (SC)','Arus angin (WC)','Leeway kiri (LW-L)','Leeway kanan (LW-R)','Garis L–R','d(L)','d(R)'];
  const miss=want.filter(w=>!ll.some(l=>l.includes(w)));
  return JSON.stringify({ok: miss.length===0, missing: miss});
})()" > /tmp/render/vectors.json 2>/dev/null
cat /tmp/render/vectors.json
if rg -q 'ok\\":true' /tmp/render/vectors.json; then
  ok "vektor standar Panduan tetap lengkap (SC, WC, LW-L, LW-R, L–R, d(L), d(R))"
else
  bad "vektor standar hilang"
fi

$AB screenshot /tmp/render/map_drawing.png
echo "screenshot saved"

# Visual tambahan: fullscreen Peta Laut → tangkian bersih kotak area + label Datum
click_js "[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Layar Penuh'))" "tombol Layar Penuh kartu Peta Laut"
sleep 2.5
$AB eval "(() => {
  // Tutup/hapus panel lapisan yang menutupi peta (jika terbuka di instansi fullscreen)
  let removed = 0;
  for (const el of document.querySelectorAll('div')) {
    if (el.className && typeof el.className === 'string' && el.className.includes('leaflet') && el.textContent.trim().startsWith('Map Layers')) {
      const panel = el.querySelector('form, .layer-row') ? el : null;
      if (panel && panel.parentElement) { panel.style.display = 'none'; removed++; }
    }
  }
  // sembunyikan panel kontrol apapun yang berisi tulisan Map Layers
  document.querySelectorAll('.leaflet-control-container form, .leaflet-control-container div').forEach((el) => {
    if (el.textContent.trim().startsWith('Map Layers') && el.querySelector('input[type=checkbox]')) { el.style.display = 'none'; removed++; }
  });
  return 'panels hidden: ' + removed;
})()"
sleep 0.6
$AB screenshot /tmp/render/map_fullscreen.png
echo "fullscreen screenshot saved"

kill $DEVPID 2>/dev/null
sleep 1
pkill -f "next dev" 2>/dev/null || true
echo "=== E2E DONE (fails=$FAILS) ==="
exit $FAILS
