#!/bin/bash
# Daily analytics report: Telegram + YouTube
cd ~/workspace

echo "=== TELEGRAM ==="
python3 skills/analytics/scripts/tg-stats.py --period=24h --json 2>&1

echo "=== YOUTUBE ==="
python3 skills/analytics/scripts/yt-deep-stats.py --days=7 --json 2>&1
