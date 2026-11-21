#!/bin/bash
# Verifikasi visual org chart mindmap pada strip tab worksheet.
set -u
cd /home/z/my-project
mkdir -p /tmp/render

rm -f /tmp/nextdev4.log
setsid bun run dev > /tmp/nextdev4.log 2>&1 &
DEVPID=$!
for i in $(seq 1 150); do
  curl -s -o /dev/null -m 3 http://localhost:3000 && { echo "READY (${i}s)"; break; }
  sleep 1
done
sleep 3

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

# Cek error console + keberadaan SVG org chart
$AB eval "(() => {
  const svg = document.querySelector('#worksheet-tabs-host > svg');
  if (!svg) return 'SVG NOT FOUND';
  const paths = svg.querySelectorAll('path');
  const dashes = svg.querySelectorAll('.mm-wire-flow');
  const comets = svg.querySelectorAll('.mm-comet');
  return 'SVG OK paths=' + paths.length + ' wires=' + dashes.length + ' comets=' + comets.length;
})()" 2>/dev/null

# Scroll ke atas & screenshot strip tab (org chart)
$AB eval "(() => { window.scrollTo(0, 0); const host = document.getElementById('worksheet-tabs-host'); host?.scrollIntoView({block:'center'}); return 'ok'; })()" >/dev/null 2>&1
sleep 1.5
$AB screenshot /tmp/render/orgchart_1.png

# Klik tab Aero Drift (aktif) — lihat highlight cabang grup udara
PAIR=$($AB eval "(() => { const t=document.querySelector('[data-tab-value=\"aero\"]'); t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); return Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2); })()" 2>/dev/null | tr -d '"' | tail -1)
$AB mouse move $(echo "$PAIR" | cut -d, -f1) $(echo "$PAIR" | cut -d, -f2); sleep 0.3; $AB mouse down left; $AB mouse up left
sleep 2.5
$AB screenshot /tmp/render/orgchart_2_active.png

# Verifikasi animasi berjalan: ambil dua snapshot dashoffset via getComputedStyle
$AB eval "(() => {
  const w = document.querySelector('#worksheet-tabs-host svg .mm-wire-flow');
  if (!w) return 'WIRE NOT FOUND';
  const o1 = getComputedStyle(w).strokeDashoffset;
  return new Promise((res) => setTimeout(() => {
    const o2 = getComputedStyle(w).strokeDashoffset;
    res('dashoffset t0=' + o1 + ' t1=' + o2 + ' bergerak=' + (o1 !== o2));
  }, 900));
})()" 2>/dev/null

ls -la /tmp/render/orgchart_*.png
kill $DEVPID 2>/dev/null
echo "DONE"
