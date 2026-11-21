#!/bin/bash
# Verifikasi perbaikan ADW: default Lembar Pesawat (da), B.6 satu baris,
# dan semua baris B.1-B.14 kanan satu baris pada view aircraft & dual.
set -u
cd /home/z/my-project
mkdir -p /tmp/render

rm -f /tmp/nextdev3.log
setsid bun run dev > /tmp/nextdev3.log 2>&1 &
DEVPID=$!
for i in $(seq 1 150); do
  curl -s -o /dev/null -m 3 http://localhost:3000 && { echo "READY (${i}s)"; break; }
  sleep 1
done
sleep 3

AB="agent-browser"
$AB set viewport 1280 800
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

# Buka tab Aero Drift
PAIR=$($AB eval "(() => { const t=[...document.querySelectorAll('[role=\"tab\"]')].find(x=>x.textContent.includes('Aero Drift')); t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
$AB mouse move $(echo "$PAIR" | cut -d, -f1) $(echo "$PAIR" | cut -d, -f2); sleep 0.3; $AB mouse down left; $AB mouse up left
sleep 4

# 1) Default view harus "Lembar Pesawat (da)"
$AB eval "(() => {
  const btns=[...document.querySelectorAll('button')].filter(b=>['Dual (Pesawat & Terjun Payung)','Lembar Pesawat (da)','Lembar Terjun Payung (dp)'].some(t=>b.textContent.includes(t)));
  const act=btns.find(b=>b.className.includes('bg-white'));
  return 'DEFAULT_ACTIVE=' + (act ? act.textContent.trim() : 'NONE');
})()" 2>/dev/null

# 2) Isi contoh data pesawat
$AB eval "(() => {
  const cb=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Hitung glide pesawat'))?.querySelector('input[type=checkbox]');
  if (cb && !cb.checked) cb.click();
  return 'cb=' + cb?.checked;
})()" 2>/dev/null
sleep 1
$AB eval "(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const put = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const a1 = document.querySelector('input[title^=\"Format bebas\"]');
  if (a1) put(a1, '17 Nov 2026 07.00 UTC');
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  if (!cont) return 'CONTAINER NOT FOUND';
  const rowByNum = (n) => [...cont.querySelectorAll(':scope > div')].find(d => {
    const s=d.querySelector('span.w-4'); return s && s.textContent.trim()===String(n) && s.nextElementSibling;
  });
  const putRow = (n, idx, v) => {
    const r=rowByNum(n); if (!r) return 'row'+n+':nf';
    const nums=[...r.querySelectorAll('input[type=number]')];
    if (!nums[idx]) return 'row'+n+':input'+idx+':nf';
    put(nums[idx], v); return 'row'+n+'['+idx+']='+v;
  };
  const out=[];
  out.push(putRow(1,0,'39000'));
  out.push(putRow(2,0,'0'));
  out.push(putRow(4,0,'4'));
  out.push(putRow(5,0,'190'));
  const hd = document.querySelector('[aria-label=\"Aircraft reported heading\"]');
  if (hd) put(hd, '158');
  a1?.dispatchEvent(new Event('blur'));
  return out.join(' | ');
})()" 2>/dev/null
sleep 3

# 3) Ukur tinggi kolom kanan tiap baris (view AIRCRAFT)
$AB eval "(() => {
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  if (!cont) return 'CONTAINER NOT FOUND';
  const rows=[...cont.querySelectorAll(':scope > div')].filter(d => {
    const s=d.querySelector('span.w-4'); return s && /^[0-9]+$/.test(s.textContent.trim());
  });
  const res = rows.map(r => {
    const n=r.querySelector('span.w-4').textContent.trim();
    const kids=[...r.querySelectorAll(':scope > div')];
    const right=kids.find(k=>k.className.includes('shrink-0'));
    const rh=right?right.getBoundingClientRect().height:-1;
    const rr=r.getBoundingClientRect();
    return n+':rightH='+Math.round(rh)+',rowH='+Math.round(rr.height)+',ovf='+(r.scrollWidth-r.clientWidth);
  });
  return 'AIRCRAFT|' + res.join(' ');
})()" 2>/dev/null

# Screenshot area B.6 (aircraft view)
$AB eval "(() => {
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  const rows=[...cont.querySelectorAll(':scope > div')].filter(d => {
    const s=d.querySelector('span.w-4'); return s && /^[0-9]+$/.test(s.textContent.trim());
  });
  const r6=rows.find(d=>d.querySelector('span.w-4').textContent.trim()==='6');
  r6.scrollIntoView({block:'center'});
  return 'scrolled';
})()" 2>/dev/null
sleep 1.5
$AB screenshot /tmp/render/adw_aircraft_b6.png

# 4) Switch ke DUAL, aktifkan parasut, isi angka parasut
$AB eval "(() => {
  const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Dual (Pesawat & Terjun Payung)'));
  btn.click(); return 'clicked dual';
})()" 2>/dev/null
sleep 1
$AB eval "(() => {
  const cb=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Hitung bagian parasut'))?.querySelector('input[type=checkbox]');
  if (cb && !cb.checked) cb.click();
  return 'chute=' + cb?.checked;
})()" 2>/dev/null
sleep 1
$AB eval "(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const put = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  const rowByNum = (n) => [...cont.querySelectorAll(':scope > div')].find(d => {
    const s=d.querySelector('span.w-4'); return s && s.textContent.trim()===String(n) && s.nextElementSibling;
  });
  const out=[];
  const r1=rowByNum(1); const n1=[...r1.querySelectorAll('input[type=number]')];
  if (n1[1]) { put(n1[1],'10000'); out.push('r1[1]=10000'); }
  const r2=rowByNum(2); const n2=[...r2.querySelectorAll('input[type=number]')];
  if (n2[1]) { put(n2[1],'0'); out.push('r2[1]=0'); }
  const rod=document.querySelector('[aria-label=\"Parachute rate of descent from table N-13\"]');
  if (rod) { put(rod,'700'); out.push('rod=700'); }
  return out.join(' | ');
})()" 2>/dev/null
sleep 3

# 5) Ukur tinggi kolom kanan tiap baris (view DUAL)
$AB eval "(() => {
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  const rows=[...cont.querySelectorAll(':scope > div')].filter(d => {
    const s=d.querySelector('span.w-4'); return s && /^[0-9]+$/.test(s.textContent.trim());
  });
  const res = rows.map(r => {
    const n=r.querySelector('span.w-4').textContent.trim();
    const kids=[...r.querySelectorAll(':scope > div')];
    const right=kids.find(k=>k.className.includes('shrink-0'));
    const rh=right?right.getBoundingClientRect().height:-1;
    const rr=r.getBoundingClientRect();
    return n+':rightH='+Math.round(rh)+',rowH='+Math.round(rr.height)+',ovf='+(r.scrollWidth-r.clientWidth);
  });
  return 'DUAL|' + res.join(' ');
})()" 2>/dev/null

# Screenshot area B.6 dan baris 10-14 (dual)
$AB eval "(() => {
  const cont = [...document.querySelectorAll('div')].find(d => d.className.includes('space-y-2 pl-6 pt-1 text-xs'));
  const rows=[...cont.querySelectorAll(':scope > div')].filter(d => {
    const s=d.querySelector('span.w-4'); return s && /^[0-9]+$/.test(s.textContent.trim());
  });
  const r6=rows.find(d=>d.querySelector('span.w-4').textContent.trim()==='6');
  r6.scrollIntoView({block:'center'});
  return 'scrolled';
})()" 2>/dev/null
sleep 1.5
$AB screenshot /tmp/render/adw_dual_b6.png
$AB eval "(() => { window.scrollBy(0, 500); return 'ok'; })()" >/dev/null 2>&1
sleep 1
$AB screenshot /tmp/render/adw_dual_rows.png
ls -la /tmp/render/adw_*.png

kill $DEVPID 2>/dev/null
echo "DONE"
