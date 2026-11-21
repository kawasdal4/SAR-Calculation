#!/bin/bash
# Verifikasi org chart mindmap: GARIS TIDAK BOLEH MELINTASI TAB MANA PUN.
# - Cek geometris: sampel tiap 2px sepanjang semua path SVG org chart,
#   tandai bila ada titik jatuh di dalam rect tab (di atas tepi bawahnya).
# - Screenshot strip tab pada dua viewport (1440 & 1100) untuk inspeksi.
set -u
cd /home/z/my-project
mkdir -p /tmp/render

rm -f /tmp/nextdev5.log
setsid bun run dev > /tmp/nextdev5.log 2>&1 &
DEVPID=$!
for i in $(seq 1 150); do
  curl -s -o /dev/null -m 3 http://localhost:3000 && { echo "READY (${i}s)"; break; }
  sleep 1
done
sleep 3

AB="agent-browser"

login_and_ready() {
  $AB set viewport "$1" "$2"
  $AB open http://localhost:3000
  $AB wait --load networkidle 2>/dev/null || true
  sleep 5
  P=$($AB eval "window.location.pathname" 2>/dev/null | tr -d '"' | tail -1)
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
  fi
  for i in $(seq 1 60); do
    T=$($AB eval "[...document.querySelectorAll('[role=\"tab\"]')].length" 2>/dev/null | tr -d '"' | tail -1)
    [ "${T:-0}" -ge 3 ] 2>/dev/null && break
    sleep 1
  done
  sleep 2
}

# Cek geometris: 0 langgar = bersih. Menyentuh TEPI BAWAH tab diperbolehkan
# (titik sambung riser), melintasi bagian dalam tab = pelanggaran.
CHECK='(() => {
  const host = document.getElementById("worksheet-tabs-host");
  const svg = host && host.querySelector(":scope > svg");
  if (!host || !svg) return "SVG NOT FOUND";
  const hr = host.getBoundingClientRect();
  const tabs = [...host.querySelectorAll("[data-tab-value]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { v: el.dataset.tabValue, l: r.left - hr.left, t: r.top - hr.top, r: r.right - hr.left, b: r.bottom - hr.top };
  });
  const paths = [...svg.querySelectorAll("path")];
  const bad = new Set();
  for (const p of paths) {
    let L = 0;
    try { L = p.getTotalLength(); } catch (e) { continue; }
    if (!isFinite(L) || L <= 0) continue;
    for (let s = 0; s <= L; s += 2) {
      const pt = p.getPointAtLength(s);
      for (const t of tabs) {
        if (pt.x > t.l && pt.x < t.r && pt.y > t.t + 1.5 && pt.y < t.b - 0.5) { bad.add(t.v); break; }
      }
    }
  }
  return "viewport=" + window.innerWidth + " paths=" + paths.length + " tabs=" + tabs.length +
    " langgar=" + bad.size + (bad.size ? " :: " + [...bad].slice(0, 12).join(",") : " (BERSIH)");
})()'

shot_host() {
  $AB eval "(() => { const h=document.getElementById('worksheet-tabs-host'); h?.scrollIntoView({block:'center'}); return 'ok'; })()" >/dev/null 2>&1
  sleep 1.2
  $AB eval "(() => { const r=document.getElementById('worksheet-tabs-host').getBoundingClientRect(); return Math.round(r.left)+','+Math.round(r.top)+','+Math.round(r.width)+','+Math.round(r.height); })()" 2>/dev/null | tr -d '"' | tail -1 > "$1"
  $AB screenshot "$2"
}

echo "=== viewport 1440x900 ==="
login_and_ready 1440 900
$AB eval "$CHECK" 2>/dev/null | tail -1
shot_host /tmp/render/hostrect_1440.txt /tmp/render/orgchart_1440.png

echo "=== viewport 1100x800 (wrap lebih banyak) ==="
$AB set viewport 1100 800
sleep 4
$AB eval "$CHECK" 2>/dev/null | tail -1
shot_host /tmp/render/hostrect_1100.txt /tmp/render/orgchart_1100.png

kill $DEVPID 2>/dev/null
echo "DONE"
