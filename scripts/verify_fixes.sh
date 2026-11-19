#!/bin/bash
# Verifikasi runtime setelah perbaikan bug apply/blink — satu sesi tunggal.
set +e
cd /home/z/my-project

setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 45); do
  curl -s --max-time 2 -o /dev/null http://localhost:3000/ && break
  sleep 1
done
ss -tln | grep -q ':3000 ' || { echo "SERVER GAGAL"; tail -20 dev.log; exit 1; }
echo "[OK] server hidup"

agent-browser set viewport 1280 800 2>/dev/null
agent-browser open http://localhost:3000/ --timeout 60000 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 45000 2>&1 | tail -1
echo "URL: $(agent-browser get url)"

# Login
agent-browser find nth 0 "input" fill "developer" 2>/dev/null
agent-browser find nth 1 "input" fill "SAR115" 2>/dev/null
agent-browser find first "button[type=submit]" click 2>&1 | tail -1
sleep 6
agent-browser wait --load networkidle --timeout 45000 2>&1 | tail -1
echo "URL setelah login: $(agent-browser get url)"
agent-browser screenshot /tmp/v1-main.png

# Cek halaman utama (all-worksheets) — cari indikasi worksheet view
agent-browser eval "document.querySelectorAll('section[id^=sec-]').length + ' section summary; WS2 label ada: ' + (document.body.innerText.includes('Worksheet No. 2') || document.body.innerText.includes('Langkah 5'))"
agent-browser screenshot /tmp/v2-allws.png --full 2>/dev/null

# Buka panel AI (tombol chat) — cari tombol dengan teks Asisten AI / Bot
agent-browser eval "Array.from(document.querySelectorAll('button')).filter(b => /asisten|ai|chat/i.test(b.innerText)).slice(0,5).map(b => b.innerText.trim()).join(' | ')"
agent-browser errors 2>&1 | head -8

echo "=== [dev.log akhir: error compile?] ==="
grep -iE "error|failed" dev.log | grep -v "0 error" | head -8 || echo "tidak ada error compile"
tail -6 dev.log
agent-browser close 2>/dev/null
PID3000=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID3000" ] && kill "$PID3000" 2>/dev/null && echo "server dimatikan rapi"
echo "SELESAI"
