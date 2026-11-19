#!/bin/bash
# Demo window: menyalakan dev server dan MENAHANNYA hidup selama satu tool-call.
# Sandbox membunuh proses background antar tool-call, jadi satu-satunya cara
# memberi user jendela preview adalah bertahan di dalam satu panggilan panjang.
set +e
cd /home/z/my-project
START=$(date +%s)
DURATION=${1:-530}   # detik, default ~8.8 menit (aman di bawah timeout 600s)

echo "=== [1] Status awal ==="
ALREADY=0
if ss -tln | grep -q ':3000 '; then
  ALREADY=1
  echo "port 3000 sudah hidup (kemungkinan boot platform menjalankannya) — pakai yang ada"
else
  setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
  for i in $(seq 1 45); do
    curl -s --max-time 2 -o /dev/null http://localhost:3000/ && break
    sleep 1
  done
  ss -tln | grep -q ':3000 ' || { echo "GAGAL START SERVER"; tail -20 dev.log; exit 1; }
  echo "server hidup (Ready)"
fi

echo ""
echo "=== [2] Pre-warm halaman (agar klik user instan) ==="
curl -s -o /dev/null -w "GET /          -> %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "GET /login     -> %{http_code}\n" http://localhost:3000/login
curl -s -c /tmp/ck.txt -o /tmp/login-resp.json -w "POST /api/auth/login -> %{http_code}\n" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"developer","password":"SAR115"}' \
  http://localhost:3000/api/auth/login
head -c 200 /tmp/login-resp.json; echo
curl -s -b /tmp/ck.txt -o /tmp/main.html -w "GET / (dengan sesi) -> %{http_code} | %{size_download} bytes\n" http://localhost:3000/
grep -oE '<title>[^<]*</title>' /tmp/main.html | head -1

echo ""
echo "=== [3] Menahan window ${DURATION}s ==="
while [ $(( $(date +%s) - START )) -lt "$DURATION" ]; do
  sleep 60
  ELAPSED=$(( $(date +%s) - START ))
  UP=$(ss -tln | grep -c ':3000 ')
  echo "[WINDOW] ${ELAPSED}s berjalan | port3000 hidup: $UP | $(date '+%H:%M:%S')"
done

echo ""
echo "=== [4] Cleanup ==="
if [ "$ALREADY" = "0" ]; then
  PID3000=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$PID3000" ] && kill "$PID3000" 2>/dev/null && echo "server dimatikan rapi (pid $PID3000)"
else
  echo "server bawaan boot dibiarkan hidup"
fi
echo "[SELESAI] window ditutup setelah $(( $(date +%s) - START ))s"
