#!/usr/bin/env python3
"""Telegram channel statistics via Telethon"""
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from telethon import TelegramClient

api_id = 30942990
api_hash = "53e56f4eb2ed7134dc731a78238a7165"
session_path = "~/.openclaw/tg-stats-session"
CHANNEL = "YOUR_CHANNEL"

async def main():
    client = TelegramClient(session_path, api_id, api_hash)
    await client.connect()
    
    if not await client.is_user_authorized():
        print("❌ Не авторизован! Запусти tg-stats-auth.py")
        return
    
    channel = await client.get_entity(CHANNEL)
    full = await client(GetFullChannelRequest(channel))
    
    subs = full.full_chat.participants_count
    
    # Get last 50 messages
    messages = await client.get_messages(channel, limit=50)
    
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    
    # Analyze
    all_posts = []
    for msg in messages:
        if msg.message or msg.media:
            all_posts.append({
                "id": msg.id,
                "date": msg.date.isoformat(),
                "views": msg.views or 0,
                "forwards": msg.forwards or 0,
                "reactions": sum(r.count for r in (msg.reactions.results if msg.reactions else [])),
                "text": (msg.message or "")[:80]
            })
    
    # Posts by period
    posts_24h = [p for p in all_posts if datetime.fromisoformat(p["date"]) > day_ago]
    posts_7d = [p for p in all_posts if datetime.fromisoformat(p["date"]) > week_ago]
    posts_30d = all_posts  # last 50 msgs likely within 30 days
    
    def avg_views(posts):
        return int(sum(p["views"] for p in posts) / len(posts)) if posts else 0
    
    def avg_er(posts, subs):
        if not posts or not subs:
            return 0
        avg_reactions = sum(p["reactions"] for p in posts) / len(posts)
        return round(avg_reactions / subs * 100, 2)
    
    # Top 5 posts by views
    top5 = sorted(all_posts, key=lambda x: x["views"], reverse=True)[:5]
    
    # Output
    report = f"""📊 Статистика YOUR_CHANNEL

👥 Подписчиков: {subs:,}

📈 За 24 часа:
  Постов: {len(posts_24h)}
  Ср. просмотры: {avg_views(posts_24h):,}

📈 За 7 дней:
  Постов: {len(posts_7d)}
  Ср. просмотры: {avg_views(posts_7d):,}
  Ср. реакции: {sum(p['reactions'] for p in posts_7d) / len(posts_7d) if posts_7d else 0:.1f}
  ERR: {avg_er(posts_7d, subs)}%

🏆 Топ-5 постов (по просмотрам):"""
    
    for i, p in enumerate(top5, 1):
        text_preview = p["text"].replace("\n", " ")[:50]
        report += f"\n  {i}. 👁 {p['views']:,} | 🔄 {p['forwards']} | ❤️ {p['reactions']} | {text_preview}..."
    
    report += f"\n\n📊 Средние за {len(all_posts)} постов:"
    report += f"\n  Просмотры: {avg_views(all_posts):,}"
    report += f"\n  Репосты: {sum(p['forwards'] for p in all_posts) / len(all_posts):.1f}"
    report += f"\n  Реакции: {sum(p['reactions'] for p in all_posts) / len(all_posts):.1f}"
    report += f"\n  ERR: {avg_er(all_posts, subs)}%"
    
    print(report)
    
    await client.disconnect()

# Fix import inside async
from telethon.tl.functions.channels import GetFullChannelRequest

asyncio.run(main())
