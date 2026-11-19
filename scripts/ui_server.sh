#!/bin/bash
# ui_server.sh — pastikan dev server hidup selama invokasi ini (dipanggil dari skrip cek).
PORT=3000
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT"; then
  cd /home/z/my-project || exit 1
  setsid nohup ./node_modules/.bin/next dev -p $PORT > /tmp/next-dev.log 2>&1 < /dev/null &
  for i in $(seq 1 90); do
    sleep 1
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT"; then break; fi
  done
fi
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT"; then
  echo "SERVER_UP"
else
  echo "SERVER_DOWN"
  tail -20 /tmp/next-dev.log
fi
