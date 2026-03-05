#!/usr/bin/env python3
"""Telegram channel statistics via Telethon.
Usage: python3 tg-stats.py [--period=7d|24h|30d] [--channel=@username] [--json]
"""
import asyncio
import argparse
import json
from datetime import datetime, timedelta, timezone
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest

API_ID = 30942990
API_HASH = "53e56f4eb2ed7134dc731a78238a7165"
SESSION = "~/.openclaw/tg-stats-session"
DEFAULT_CHANNEL = "YOUR_CHANNEL"

def parse_period(s):
    if s.endswith("h"):
        return timedelta(hours=int(s[:-1]))
    elif s.endswith("d"):
        return timedelta(days=int(s[:-1]))
    return timedelta(days=7)

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--period", default="7d")
    parser.add_argument("--channel", default=DEFAULT_CHANNEL)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("❌ Не авторизован! Запусти tg-stats-auth.py")
        return

    channel = await client.get_entity(args.channel)
    full = await client(GetFullChannelRequest(channel))
    subs = full.full_chat.participants_count

    messages = await client.get_messages(channel, limit=args.limit)
    now = datetime.now(timezone.utc)
    period = parse_period(args.period)
    cutoff = now - period

    posts = []
    for msg in messages:
        if not (msg.message or msg.media):
            continue
        reactions = sum(r.count for r in (msg.reactions.results if msg.reactions else []))
        posts.append({
            "id": msg.id,
            "date": msg.date.isoformat(),
            "views": msg.views or 0,
            "forwards": msg.forwards or 0,
            "reactions": reactions,
            "text": (msg.message or "[медиа]")[:100].replace("\n", " ")
        })

    period_posts = [p for p in posts if datetime.fromisoformat(p["date"]) > cutoff]

    def avg(lst, key):
        return int(sum(p[key] for p in lst) / len(lst)) if lst else 0

    def err(lst):
        if not lst or not subs:
            return 0
        return round(sum(p["reactions"] for p in lst) / len(lst) / subs * 100, 2)

    top = sorted(period_posts or posts, key=lambda x: x["views"], reverse=True)[:args.top]

    result = {
        "channel": args.channel,
        "subscribers": subs,
        "period": args.period,
        "period_posts": len(period_posts),
        "avg_views": avg(period_posts, "views"),
        "avg_forwards": round(sum(p["forwards"] for p in period_posts) / len(period_posts), 1) if period_posts else 0,
        "avg_reactions": round(sum(p["reactions"] for p in period_posts) / len(period_posts), 1) if period_posts else 0,
        "err": err(period_posts),
        "total_posts_fetched": len(posts),
        "all_time_avg_views": avg(posts, "views"),
        "all_time_err": err(posts),
        "top_posts": top
    }

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"📊 {args.channel} - Статистика за {args.period}\n")
        print(f"👥 Подписчиков: {subs:,}")
        print(f"📝 Постов за период: {len(period_posts)}")
        print(f"👁 Ср. просмотры: {avg(period_posts, 'views'):,}")
        print(f"🔄 Ср. репосты: {result['avg_forwards']}")
        print(f"❤️ Ср. реакции: {result['avg_reactions']}")
        print(f"📈 ERR: {result['err']}%")
        print(f"\n🏆 Топ-{args.top} постов:")
        for i, p in enumerate(top, 1):
            print(f"  {i}. 👁 {p['views']:,} | 🔄 {p['forwards']} | ❤️ {p['reactions']} | {p['text'][:50]}...")
        print(f"\n📊 Средние за все {len(posts)} постов:")
        print(f"  Просмотры: {avg(posts, 'views'):,} | ERR: {result['all_time_err']}%")

    await client.disconnect()

asyncio.run(main())
