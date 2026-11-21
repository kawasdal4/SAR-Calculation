#!/bin/bash
# Screenshot area baris B.6-B.14 worksheet ADW (lanjutan e2e_adw_b_fix.sh).
set -u
cd /home/z/my-project

rm -f /tmp/nextdev2.log
setsid bun run dev > /tmp/nextdev2.log 2>&1 &
DEVPID=$!
for i in $(seq 1 120); do
  curl -s -o /dev/null -m 3 http://localhost:3000 && { echo "READY (${i}s)"; break; }
  sleep 1
done
sleep 3

AB="agent-browser"
$AB set viewport 1600 900
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
  $AB eval "(() => { const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Masuk')); const r=btn.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" > /tmp/loginpair.txt
  $AB mouse move $(cut -d, -f1 /tmp/loginpair.txt) $(cut -d, -f2 /tmp/loginpair.txt); $AB mouse down left; $AB mouse up left
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

# Ke tab ADW
$AB eval "(() => { const t=[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('Aero Drift')); t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" > /tmp/tabpair.txt
$AB mouse move $(cut -d, -f1 /tmp/tabpair.txt) $(cut -d, -f2 /tmp/tabpair.txt); sleep 0.3; $AB mouse down left; $AB mouse up left
sleep 3

# Isi cepat (checkbox + angka) bila kosong
$AB eval "(() => {
  const cb=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Hitung glide pesawat'))?.querySelector('input[type=checkbox]');
  if (cb && !cb.checked) cb.click();
  return 'cb=' + cb?.checked;
})()" 2>/dev/null
sleep 1

# Isi nilai contoh panduan (A.1 + Altmax/Altmin/gr/TASg/heading)
$AB eval "(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const put = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const a1 = document.querySelector('input[title^=\"Format bebas\"]');
  if (a1) put(a1, '17 Nov 2026 07.00 UTC');
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  if (!cont) return 'CONTAINER NOT FOUND';
  const nums = [...cont.querySelectorAll('input[type=number]')];
  put(nums[0], '39000');   // B.1 Altmax pesawat
  put(nums[2], '0');       // B.2 Altmin pesawat
  put(nums[4], '4');       // B.4 glide ratio pesawat
  put(nums[5], '190');     // B.5 TASg pesawat
  const hd = document.querySelector('[aria-label=\"Aircraft reported heading\"]');
  if (hd) put(hd, '158');
  // blur A.1 agar normalisasi Basarnas jalan
  a1?.dispatchEvent(new Event('blur'));
  return 'filled';
})()" 2>/dev/null
sleep 3

# Scroll ke baris 6 (Rate of descent) dan screenshot area baris 6-14
$AB eval "(() => {
  const rows=[...document.querySelectorAll('div')].filter(d=>d.className.includes && d.className.includes('border-b') && d.querySelector('span.w-4') && /^[0-9]+$/.test(d.querySelector('span.w-4').textContent.trim()));
  const r6=rows.find(d=>d.querySelector('span.w-4').textContent.trim()==='6');
  if (!r6) return 'row6 not found';
  r6.scrollIntoView({block:'start'});
  window.scrollBy(0,-80);
  return 'scrolled';
})()" 2>/dev/null
sleep 1.5
$AB screenshot /tmp/render/adw_rows_1.png
# Scroll lebih jauh untuk baris 10-14
$AB eval "(() => { window.scrollBy(0, 420); return 'ok'; })()" >/dev/null 2>&1
sleep 1
$AB screenshot /tmp/render/adw_rows_2.png
ls -la /tmp/render/adw_rows_*.png

kill $DEVPID 2>/dev/null
echo "DONE"
