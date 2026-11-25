#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1

URL="http://localhost:5173"

if curl -sf "$URL" >/dev/null 2>&1; then
  echo "Topog zaten çalışıyor, tarayıcıda açılıyor..."
  open "$URL"
  exit 0
fi

if [ ! -d "node_modules" ]; then
  echo "Bağımlılıklar kuruluyor..."
  npm install || exit 1
fi

(
  for _ in $(seq 1 30); do
    if curl -sf "$URL" >/dev/null 2>&1; then
      open "$URL"
      break
    fi
    sleep 0.5
  done
) &

echo "Topog başlatılıyor ($URL)..."
echo "Kapatmak için Ctrl+C tuşlarına basabilir veya bu pencereyi kapatabilirsiniz."
npm run dev -- --port 5173
