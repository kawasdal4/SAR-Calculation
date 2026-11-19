#!/bin/bash
# Verifikasi end-to-end dev server SAR-Calculation dalam SATU sesi shell.
# Server dev hanya bisa hidup selama satu tool-call (sandbox membunuh proses
# background antar panggilan), jadi semua langkah harus sekali jalan di sini.
set +e
cd /home/z/my-project

echo "=== [1] Pastikan agent-browser tersedia ==="
if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser belum ada, install via npm..."
  npm install -g agent-browser >/tmp/ab-install.log 2>&1
  echo "npm install exit: $?"
  tail -2 /tmp/ab-install.log
fi
if ! ls ~/.cache/ms-playwright >/dev/null 2>&1 || [ -z "$(ls ~/.cache/ms-playwright 2>/dev/null)" ]; then
  echo "browser binary belum ada, download..."
  agent-browser install >/tmp/ab-browser.log 2>&1
  echo "agent-browser install exit: $?"
fi
command -v agent-browser && agent-browser --version 2>/dev/null

echo ""
echo "=== [2] Start dev server ==="
setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
sleep 3
UP=0
for i in $(seq 1 45); do
  if curl -s --max-time 2 -o /dev/null http://localhost:3000/; then
    echo "server UP (percobaan ke-$i)"
    UP=1
    break
  fi
  sleep 1
done
if [ "$UP" != "1" ]; then
  echo "SERVER GAGAL START:"
  tail -25 dev.log
  exit 1
fi
ss -tln | grep 3000

echo ""
echo "=== [3] Curl: cek redirect dan halaman login ==="
curl -s -o /dev/null -w "GET /      -> HTTP %{http_code} redirect: %{redirect_url}\n" http://localhost:3000/
curl -sL -o /tmp/login.html -w "GET / (follow) -> HTTP %{http_code} | %{size_download} bytes\n" --max-time 90 http://localhost:3000/
grep -oE '<title>[^<]*</title>' /tmp/login.html | head -1

echo ""
echo "=== [4] Browser: buka aplikasi ==="
agent-browser set viewport 1280 800
agent-browser open http://localhost:3000/ --timeout 60000
agent-browser wait --load networkidle --timeout 45000
echo "URL sekarang: $(agent-browser get url)"
agent-browser screenshot /tmp/shot-1-login.png
echo "screenshot login: $?"

echo ""
echo "=== [5] Inspeksi form login ==="
agent-browser eval "Array.from(document.querySelectorAll('input')).map(function(i,idx){return idx+':'+i.type+':'+(i.name||'-')+':'+(i.placeholder||'-')}).join(' | ')"
agent-browser eval "Array.from(document.querySelectorAll('button')).map(function(b,idx){return idx+':'+(b.type||'-')+':'+(b.textContent.trim().slice(0,30))}).join(' | ')"

echo ""
echo "=== [6] Login (developer / SAR115) ==="
NFIELDS=$(agent-browser eval "document.querySelectorAll('input').length")
echo "jumlah input: $NFIELDS"
agent-browser find nth 0 "input" fill "developer"
if [ "$NFIELDS" -ge 3 ] 2>/dev/null; then
  agent-browser find nth 1 "input" fill "developer@sar.local"
  agent-browser find nth 2 "input" fill "SAR115"
else
  agent-browser find nth 1 "input" fill "SAR115"
fi
agent-browser find first "button[type=submit]" click
sleep 5
agent-browser wait --load networkidle --timeout 30000
echo "URL setelah login: $(agent-browser get url)"
agent-browser screenshot /tmp/shot-2-after-login.png
agent-browser errors | head -5

echo ""
echo "=== [7] Snapshot aplikasi utama ==="
agent-browser snapshot -i -d 3 2>&1 | head -50

echo ""
echo "=== [8] Dev.log akhir ==="
tail -12 dev.log

echo ""
echo "=== [9] Cleanup ==="
agent-browser close 2>/dev/null
PID3000=$(ss -tlnp 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID3000" ] && kill "$PID3000" 2>/dev/null && echo "dev server dimatikan rapi (pid $PID3000)"
echo "SELESAI"
