#!/bin/bash
# Verifikasi visual perbaikan worksheet ADW (B.6/B.7/B.8/B.10 desimal 4,
# B.7/B.11/B.12/B.13/B.14 satu baris, B.13 = A.1 + B.7 dibulatkan muncul).
set -u
cd /home/z/my-project
mkdir -p /tmp/render

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
sleep 5

AB="agent-browser"
FAILS=0

click_js() {
  local ST=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); if(r.width<5||r.height<5) return 'hidden'; b.scrollIntoView({block:'center'}); return 'ok'; })()" 2>/dev/null | tr -d '"' | tail -1)
  if [ "$ST" = "null" ] || [ "$ST" = "hidden" ]; then echo "CLICK TARGET NOT FOUND/$ST: $2"; FAILS=$((FAILS+1)); return 1; fi
  sleep 0.6
  local PAIR=$($AB eval "(() => { const b=($1); if(!b) return 'null'; const r=b.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
  if [[ ! "$PAIR" =~ ^[0-9]+,[0-9]+$ ]]; then echo "CLICK TARGET NOT FOUND/$PAIR: $2"; FAILS=$((FAILS+1)); return 1; fi
  $AB mouse move "${PAIR%,*}" "${PAIR#*,}"
  sleep 0.3
  $AB mouse down left
  $AB mouse up left
  echo "click ($2) @ $PAIR"
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

set_checked() {
  $AB eval "(() => {
    const el = ($1);
    if (!el) return 'CHECKBOX NOT FOUND';
    if (el.checked) return 'already checked';
    el.click();
    return 'checked';
  })()" 2>/dev/null | tr -d '"' | tail -1
  sleep 0.6
}

$AB set viewport 1600 900
$AB open http://localhost:3000
$AB wait --load networkidle 2>/dev/null || true
sleep 6

echo "=== 0. Login developer ==="
set_input "document.querySelector('input[placeholder=\"Username / Email / NIP\"]')" "developer" "identifier"
set_input "document.querySelector('input[placeholder=\"Password\"]')" "dev12345" "password"
click_js "[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Masuk') || x.type==='submit')" "tombol Masuk"
sleep 3
# Tunggu redirect ke halaman utama (kompilasi halaman bisa >10s saat pertama)
for i in $(seq 1 60); do
  P=$($AB eval "window.location.pathname" 2>/dev/null | tr -d '"' | tail -1)
  [ "$P" = "/" ] && { echo "LOGIN OK (${i}s)"; break; }
  sleep 1
done
P=$($AB eval "window.location.pathname" 2>/dev/null | tr -d '"' | tail -1)
echo "pathname=$P"
[ "$P" = "/" ] || { echo "LOGIN GAGAL"; kill $DEVPID 2>/dev/null; exit 1; }
# Tunggu tab worksheet muncul
for i in $(seq 1 60); do
  T=$($AB eval "[...document.querySelectorAll('[role=\"tab\"]')].length" 2>/dev/null | tr -d '"' | tail -1)
  [ "${T:-0}" -ge 3 ] 2>/dev/null && { echo "TABS READY (${i}s): $T"; break; }
  sleep 1
done
sleep 2

echo "=== 1. Tab AWA + Muat Contoh (agar AWA valid → B.10/B.11/B.12/B.14 terisi) ==="
click_js "[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('1. AWA'))" "tab AWA"
sleep 2
click_js "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Contoh')" "Contoh AWA"
sleep 3

echo "=== 2. Tab ADW ==="
click_js "[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('Aero Drift'))" "tab ADW"
sleep 2

echo "=== 3. Aktifkan glide pesawat + isi data contoh panduan ==="
set_checked "[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Hitung glide pesawat'))?.querySelector('input[type=checkbox]')"
set_input "document.querySelector('input[title^=\"Format bebas\"]')" "17 Nov 2026 07.00 UTC" "A.1 waktu insiden"
$AB eval "(() => {
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  if (!cont) return 'CONTAINER NOT FOUND';
  const nums = [...cont.querySelectorAll('input[type=number]')];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const put = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  // urutan: altMax pesawat, altMax parasut, altMin pesawat, altMin parasut, gr pesawat, TASg pesawat, ...
  put(nums[0], '39000');   // B.1 Altmax pesawat
  put(nums[2], '0');       // B.2 Altmin pesawat
  put(nums[4], '4');       // B.4 glide ratio pesawat
  put(nums[5], '190');     // B.5 TASg pesawat
  return 'filled ' + nums.length + ' number inputs';
})()" 2>/dev/null | tr -d '"' | tail -1
set_input "document.querySelector('[aria-label=\"Aircraft reported heading\"]')" "158" "B.9 heading pesawat"
sleep 2

echo "=== 4. Verifikasi nilai & tata letak ==="
$AB eval "(() => {
  const out = [];
  const rows = [...document.querySelectorAll('div.border-b, div.border-b-2')].filter(d => /^[0-9]+$/.test((d.querySelector('span.w-4')||{}).textContent||''));
  const rowOf = (n) => rows.find(d => (d.querySelector('span.w-4')||{}).textContent?.trim() === String(n));
  const txt = (n) => (rowOf(n)?.textContent || '').replace(/\s+/g,' ').trim().slice(0, 220);
  // Nilai kunci
  const t6 = txt(6), t7 = txt(7), t8 = txt(8), t10 = txt(10), t11 = txt(11), t12 = txt(12), t13 = txt(13), t14 = txt(14);
  out.push('B.6: ' + t6);
  out.push('B.7: ' + t7);
  out.push('B.8: ' + t8);
  out.push('B.10: ' + t10);
  out.push('B.13: ' + t13);
  // Satu baris kanan: container whitespace-nowrap tingginya 1 baris (<=24px)
  const oneLine = (n) => {
    const row = rowOf(n);
    const right = [...(row?.querySelectorAll('div')||[])].find(d => d.className.includes('whitespace-nowrap') && d.className.includes('shrink-0'));
    if (!right) return 'no-right';
    const h = right.getBoundingClientRect().height;
    return h <= 24 ? 'ONE_LINE(' + Math.round(h) + 'px)' : 'WRAPPED(' + Math.round(h) + 'px)';
  };
  for (const n of [7, 11, 12, 13, 14]) out.push('baris ' + n + ' kanan: ' + oneLine(n));
  return out.join('\n');
})()" 2>/dev/null

echo "=== 5. Screenshot ==="
$AB eval "(() => { const el=[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('Aero Drift')); el?.scrollIntoView(); return 'ok'; })()" >/dev/null 2>&1
$AB screenshot --full-page /tmp/render/adw_fix_full.png 2>/dev/null || $AB screenshot /tmp/render/adw_fix.png
ls -la /tmp/render/adw_fix*.png

kill $DEVPID 2>/dev/null
echo "DONE fails=$FAILS"
