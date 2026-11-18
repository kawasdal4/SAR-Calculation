#!/bin/bash
# E2E verifikasi "Panduan Datum Worksheet 1" di web app SAR.
# Alur: ASW sample case (semua baris diubah ke 270°T/15 kn → ASW 270/15,
# totalHours 15) → tab WS 1: LKP −5.5/106.0, arus laut 045°/0.5 kn,
# leeway PIW scuba, X=Y=0.1 → cek Worksheet 1 menampilkan nilai Panduan:
#   S 7.50 NM/045, Wc 8.10 NM/090, LW 2.78 NM (060/120),
#   P1/P2/L/R/B, A→B 71.5°T/16.67 NM, De 3.4780, E 3.48, R 4 NM,
#   luas lingkaran 50.27 NM², DTG datum 230700Z NOV
# → cek peta laut: marker A/L/R/Datum B + label vektor + lingkaran.
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
  # $1 = selector-expr untuk input; $2 = nilai; $3 = label log
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
# Ubah semua baris pengamatan: input pertama (arah B) = 270, kedua (kecepatan C) = 15
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
$AB eval "(() => { const s=[...document.querySelectorAll('span')].find(x=>/^ASW: \\d+°T \\/ .* kts$/.test(x.textContent.trim())); return s ? 'ASW BADGE: '+s.textContent.trim() : 'ASW BADGE NOT FOUND'; })()"
$AB eval "(() => { const sp=[...document.querySelectorAll('span')].find(x=>x.textContent.trim().startsWith('ASW:')); return sp ? sp.textContent.trim() : 'none'; })"

echo "=== 2. WS 1: LKP + arus laut + leeway scuba + X/Y ==="
tab_click "4. WS 1"
sleep 2.5
set_input "[...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')==='Latitude LKP' && i.getBoundingClientRect().width>5)" "-5.5" "lat LKP"
sleep 0.5
set_input "[...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')==='Longitude LKP' && i.getBoundingClientRect().width>5)" "106.0" "lng LKP"
sleep 0.5
$AB eval "(() => { const t=[...document.querySelectorAll('span')].map(s=>s.textContent).join('|'); return t.includes('05°00′00.0″S') || t.includes('05°30′00.0″S') || t.includes('-5.5') ? 'LKP shown' : 'LKP display check: '+t.slice(0,200); })"

# Sea current set (045) & drift (0.5) — dua NumberInput di kartu TWC
$AB eval "(() => {
  const cards=[...document.querySelectorAll('[data-slot=card]')];
  const c=cards.find(x=>x.textContent.includes('Total Water Current (TWC)'));
  if(!c) return 'TWC CARD NOT FOUND';
  const labels=[...c.querySelectorAll('label')];
  const setL=labels.find(l=>l.textContent.includes('Sea Current Set'));
  const drL=labels.find(l=>l.textContent.includes('Sea Current Drift'));
  if(!setL||!drL) return 'LABELS NOT FOUND: '+labels.map(l=>l.textContent.slice(0,25)).join(' / ');
  const setI=setL.parentElement.querySelector('input[type=number]');
  const drI=drL.parentElement.querySelector('input[type=number]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(setI,'45'); setI.dispatchEvent(new Event('input',{bubbles:true}));
  setter.call(drI,'0.5'); drI.dispatchEvent(new Event('input',{bubbles:true}));
  return 'sea current set 45 / 0.5';
})()"
sleep 0.6

# Leeway object: pilih PIW scuba (Radix select di kartu Leeway (LW))
click_js "(() => { const c=[...document.querySelectorAll('[data-slot=card]')].find(x=>x.textContent.includes('Leeway (LW)')); const t=c?c.querySelector('[data-slot=select-trigger]'):null; return t; })()" "leeway select trigger"
sleep 1
click_js "[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('PIW – Horizontal, Scuba Suit'))" "opsi scuba"
sleep 1.2

# X dan Y = 0.1 di kartu Total Probable Error (E)
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

echo "=== 3. Verifikasi nilai Worksheet 1 (Panduan Datum) ==="
$AB eval "(() => {
  const cards=[...document.querySelectorAll('[data-slot=card]')];
  const c=cards.find(x=>x.querySelector('[data-slot=card-title]')?.textContent.includes('WORKSHEET 1 MARITIME PLANNING'));
  if(!c) return 'WS1 CARD NOT FOUND';
  const t=c.innerText;
  const want=[
    ['S 7.50 NM','7.50'],
    ['Wc 8.10 NM','8.10'],
    ['LW 2.78 NM','2.78'],
    ['LW 0.185 kn','0.185'],
    ['arah LW 060','060'],
    ['arah LW 120','120'],
    ['P1 5°24.7′S','5°24.7′S'],
    ['P1 106°05.3′E','106°05.3′E'],
    ['P2 106°13.5′E','106°13.5′E'],
    ['L/R 106°15.9′E','106°15.9′E'],
    ['B 5°24.7′S','5°24.7′S'],
    ['Bearing 71.5','71.5'],
    ['jarak 16.67','16.67'],
    ['de(L) 2.1455','2.1455'],
    ['de(R) 2.0354','2.0354'],
    ['LR 2.7750','2.7750'],
    ['De 3.4780','3.4780'],
    ['E 3.48','3.48'],
    ['R exact 3.83','3.83'],
    ['R bulat 4','(Radius R)'],
    ['luas 50.27','50.27'],
    ['persegi 64','64'],
    ['DTG 230700Z','230700Z NOV'],
  ];
  const miss=[];
  for (const [name, needle] of want) { if (!t.includes(needle)) miss.push(name+':'+needle); }
  window.__ws1text = t;
  return miss.length===0 ? 'ALL 23 EXPECTED VALUES PRESENT' : 'MISSING: '+miss.join(' ; ');
})()"
$AB eval "(() => { window.__ws1text && fetch('http://localhost:3000').catch(()=>{}); return (window.__ws1text||'').length; })"

echo "=== 4. Verifikasi peta laut: marker + vektor + lingkaran Panduan ==="
sleep 1
$AB eval "(() => {
  const labels=[...document.querySelectorAll('.sar-point-label')].map(n=>n.textContent.trim());
  const hasA=labels.some(l=>l.includes('LKP') || l.includes('A –'));
  const hasB=labels.some(l=>l.startsWith('Datum B'));
  const markerCount=document.querySelectorAll('.sar-marker').length;
  return 'datum B label='+hasB+' total marker icons='+markerCount+' :: '+labels.join(' | ');
})()"
$AB eval "(() => {
  const ll=[...document.querySelectorAll('.sar-line-label-text')].map(n=>n.textContent.trim());
  const want=['Arus laut (SC)','Arus angin (WC)','Leeway kiri (LW-L)','Leeway kanan (LW-R)','Garis L–R','d(L)','d(R)'];
  const miss=want.filter(w=>!ll.some(l=>l.includes(w)));
  return miss.length===0 ? 'ALL VECTOR LABELS PRESENT ('+ll.length+' labels)' : 'MISSING: '+miss.join(',')+' :: '+ll.join(' | ');
})()"
$AB eval "(() => {
  const map=document.querySelector('.seamap-map');
  if(!map) return 'MAP NOT FOUND';
  const paths=map.querySelectorAll('path').length;
  // lingkaran Leaflet = path dengan fill (lingkaran geodesik Leaflet pakai _path)
  const circles=[...map.querySelectorAll('path')].filter(p=>p.getAttribute('fill') && p.getAttribute('fill')!=='none').length;
  return 'map paths='+paths+' filled(circle-like)='+circles;
})()"

echo "=== 5. Cek peringatan & asumsi panel ==="
$AB eval "(() => {
  const cards=[...document.querySelectorAll('[data-slot=card]')];
  const c=cards.find(x=>x.querySelector('[data-slot=card-title]')?.textContent.includes('WORKSHEET 1 MARITIME PLANNING'));
  if(!c) return 'NO CARD';
  const t=c.innerText.toLowerCase();
  return 'peringatan=' + t.includes('peringatan (panduan bagian 7)') + ' asumsi=' + t.includes('asumsi yang dipakai') + ' koef=' + t.includes('0,036') + ' smc=' + t.includes('smc') + ' clamp=' + t.includes('dijadikan 0');
})()"

$AB screenshot /tmp/render/datum_ws1.png
echo "screenshot saved"

# Bersihkan: matikan dev server
kill $DEVPID 2>/dev/null
sleep 1
pkill -f "next dev" 2>/dev/null || true
echo "=== E2E DONE (fails=$FAILS) ==="
