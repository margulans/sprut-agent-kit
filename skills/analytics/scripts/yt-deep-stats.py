#!/usr/bin/env python3
"""YouTube Analytics deep stats via YouTube Analytics API v2.
Usage: python3 yt-deep-stats.py [--days=30] [--json]
"""
import pickle
import os
import json
import argparse
from datetime import datetime, timedelta
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

TOKEN_PATH = os.path.expanduser("~/.openclaw/yt-analytics-token.pickle")

def get_creds():
    with open(TOKEN_PATH, "rb") as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)
    return creds

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    creds = get_creds()
    yt_analytics = build("youtubeAnalytics", "v2", credentials=creds)
    yt_data = build("youtube", "v3", credentials=creds)

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=args.days)).strftime("%Y-%m-%d")
    prev_start = (datetime.now() - timedelta(days=args.days * 2)).strftime("%Y-%m-%d")
    prev_end = start_date

    # Channel info
    ch_resp = yt_data.channels().list(part="statistics,snippet", mine=True).execute()
    ch = ch_resp["items"][0]
    subs = int(ch["statistics"]["subscriberCount"])
    total_views = int(ch["statistics"]["viewCount"])
    total_videos = int(ch["statistics"]["videoCount"])
    channel_name = ch["snippet"]["title"]

    # Current period stats
    response = yt_analytics.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        metrics="views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares",
    ).execute()

    row = response.get("rows", [[0]*8])[0]
    views, watch_min, avg_duration, subs_gained, subs_lost, likes, comments, shares = row

    # Previous period for comparison
    prev_resp = yt_analytics.reports().query(
        ids="channel==MINE",
        startDate=prev_start,
        endDate=prev_end,
        metrics="views,estimatedMinutesWatched,subscribersGained,subscribersLost",
    ).execute()
    prev_row = prev_resp.get("rows", [[0]*4])[0]
    prev_views, prev_watch, prev_subs_g, prev_subs_l = prev_row

    # Daily breakdown
    daily = yt_analytics.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        dimensions="day",
        metrics="views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        sort="day"
    ).execute()

    # Top videos by views
    top_videos = yt_analytics.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        dimensions="video",
        metrics="views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares",
        sort="-views",
        maxResults=10
    ).execute()

    # Traffic sources
    traffic = yt_analytics.reports().query(
        ids="channel==MINE",
        startDate=start_date,
        endDate=end_date,
        dimensions="insightTrafficSourceType",
        metrics="views",
        sort="-views"
    ).execute()

    # Get video titles
    video_ids = [r[0] for r in top_videos.get("rows", [])]
    titles = {}
    if video_ids:
        vids = yt_data.videos().list(part="snippet", id=",".join(video_ids)).execute()
        for v in vids.get("items", []):
            titles[v["id"]] = v["snippet"]["title"]

    def delta(cur, prev):
        if prev == 0:
            return "+∞" if cur > 0 else "0"
        pct = (cur - prev) / prev * 100
        return f"+{pct:.0f}%" if pct >= 0 else f"{pct:.0f}%"

    def fmt_duration(secs):
        m, s = divmod(int(secs), 60)
        return f"{m}:{s:02d}"

    result = {
        "channel": channel_name,
        "period": f"{start_date} - {end_date}",
        "days": args.days,
        "subscribers": subs,
        "total_views": total_views,
        "total_videos": total_videos,
        "period_stats": {
            "views": views,
            "views_delta": delta(views, prev_views),
            "watch_minutes": watch_min,
            "watch_delta": delta(watch_min, prev_watch),
            "avg_view_duration_sec": avg_duration,
            "subs_gained": subs_gained,
            "subs_lost": subs_lost,
            "net_subs": subs_gained - subs_lost,
            "net_subs_delta": delta(subs_gained - subs_lost, prev_subs_g - prev_subs_l),
            "likes": likes,
            "comments": comments,
            "shares": shares
        },
        "top_videos": [
            {
                "id": r[0],
                "title": titles.get(r[0], "?"),
                "views": r[1],
                "watch_min": r[2],
                "avg_duration": r[3],
                "likes": r[4],
                "comments": r[5],
                "shares": r[6]
            } for r in top_videos.get("rows", [])
        ],
        "traffic_sources": [
            {"source": r[0], "views": r[1]}
            for r in traffic.get("rows", [])
        ]
    }

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        net = subs_gained - subs_lost
        watch_hours = watch_min / 60

        print(f"📺 {channel_name} - Аналитика за {args.days} дней")
        print(f"📅 {start_date} → {end_date}\n")
        print(f"👥 Подписчиков: {subs:,}")
        print(f"   Прирост: +{subs_gained:,} / Ушло: -{subs_lost:,} / Нетто: {'+' if net>=0 else ''}{net:,} ({result['period_stats']['net_subs_delta']})")
        print(f"\n👁 Просмотры: {views:,} ({result['period_stats']['views_delta']})")
        print(f"⏱ Watch time: {watch_hours:,.1f} часов ({result['period_stats']['watch_delta']})")
        print(f"⏱ Ср. просмотр: {fmt_duration(avg_duration)}")
        print(f"👍 Лайки: {likes:,} | 💬 Комменты: {comments:,} | 🔄 Шеры: {shares:,}")

        print(f"\n🏆 Топ-10 видео:")
        for i, v in enumerate(result["top_videos"][:10], 1):
            print(f"  {i}. 👁 {v['views']:,} | ⏱ {fmt_duration(v['avg_duration'])} | 👍 {v['likes']:,} | {v['title'][:50]}")

        print(f"\n📡 Источники трафика:")
        for t in result["traffic_sources"][:7]:
            pct = t["views"] / views * 100 if views else 0
            print(f"  {t['source']}: {t['views']:,} ({pct:.1f}%)")

main()
