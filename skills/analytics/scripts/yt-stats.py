#!/usr/bin/env python3
"""YouTube channel statistics via Data API v3 or scraping.
Usage: python3 yt-stats.py [--channel=@username] [--api-key=KEY] [--json]

Without API key: uses public RSS + oembed (limited but free, no setup).
With API key: full stats via YouTube Data API v3.
"""
import asyncio
import json
import argparse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

YT_CHANNEL_ID = "YOUR_CHANNEL_ID"  # YOUR_YOUTUBE_HANDLE
YT_HANDLE = "YOUR_YOUTUBE_HANDLE"
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={YT_CHANNEL_ID}"

def fetch_rss():
    """Fetch recent videos via public RSS feed (no API key needed)"""
    req = urllib.request.Request(RSS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read().decode()
    
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/"
    }
    root = ET.fromstring(data)
    
    channel_title = root.find("atom:title", ns).text
    
    videos = []
    for entry in root.findall("atom:entry", ns):
        vid_id = entry.find("yt:videoId", ns).text
        title = entry.find("atom:title", ns).text
        published = entry.find("atom:published", ns).text
        
        # Get view count from media:statistics
        stats = entry.find("media:group/media:community/media:statistics", ns)
        views = int(stats.get("views", 0)) if stats is not None else 0
        
        # Get star rating
        star = entry.find("media:group/media:community/media:starRating", ns)
        likes = 0
        if star is not None:
            count = int(star.get("count", 0))
            avg_rating = float(star.get("average", 0))
            # Approximate likes from rating (5=like, 1=dislike)
            likes = int(count * (avg_rating - 1) / 4) if count > 0 else 0
        
        videos.append({
            "id": vid_id,
            "title": title,
            "published": published,
            "views": views,
            "likes": likes,
            "url": f"https://youtu.be/{vid_id}"
        })
    
    return channel_title, videos

def fetch_api(api_key):
    """Fetch via YouTube Data API v3 (requires key)"""
    # Channel stats
    url = f"https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id={YT_CHANNEL_ID}&key={api_key}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read())
    
    ch = data["items"][0]
    stats = ch["statistics"]
    title = ch["snippet"]["title"]
    
    channel_stats = {
        "subscribers": int(stats.get("subscriberCount", 0)),
        "total_views": int(stats.get("viewCount", 0)),
        "total_videos": int(stats.get("videoCount", 0))
    }
    
    # Recent videos
    url2 = f"https://www.googleapis.com/youtube/v3/search?part=id&channelId={YT_CHANNEL_ID}&order=date&maxResults=10&type=video&key={api_key}"
    with urllib.request.urlopen(url2, timeout=15) as resp:
        search_data = json.loads(resp.read())
    
    video_ids = ",".join(item["id"]["videoId"] for item in search_data.get("items", []))
    
    if video_ids:
        url3 = f"https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id={video_ids}&key={api_key}"
        with urllib.request.urlopen(url3, timeout=15) as resp:
            vid_data = json.loads(resp.read())
        
        videos = []
        for item in vid_data.get("items", []):
            vs = item["statistics"]
            videos.append({
                "id": item["id"],
                "title": item["snippet"]["title"],
                "published": item["snippet"]["publishedAt"],
                "views": int(vs.get("viewCount", 0)),
                "likes": int(vs.get("likeCount", 0)),
                "comments": int(vs.get("commentCount", 0)),
                "url": f"https://youtu.be/{item['id']}"
            })
    else:
        videos = []
    
    return title, channel_stats, videos

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--top", type=int, default=5)
    args = parser.parse_args()

    if args.api_key:
        title, ch_stats, videos = fetch_api(args.api_key)
        top = sorted(videos, key=lambda x: x["views"], reverse=True)[:args.top]
        
        result = {
            "channel": title,
            "handle": YT_HANDLE,
            **ch_stats,
            "recent_videos": videos,
            "top_videos": top
        }
        
        if args.as_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"📺 {title} ({YT_HANDLE})\n")
            print(f"👥 Подписчиков: {ch_stats['subscribers']:,}")
            print(f"👁 Всего просмотров: {ch_stats['total_views']:,}")
            print(f"🎬 Видео: {ch_stats['total_videos']}")
            print(f"\n🏆 Последние видео:")
            for i, v in enumerate(videos[:args.top], 1):
                print(f"  {i}. 👁 {v['views']:,} | 👍 {v['likes']:,} | 💬 {v.get('comments',0):,}")
                print(f"     {v['title'][:60]}")
    else:
        title, videos = fetch_rss()
        top = sorted(videos, key=lambda x: x["views"], reverse=True)[:args.top]
        total_views = sum(v["views"] for v in videos)
        avg_views = total_views // len(videos) if videos else 0
        
        result = {
            "channel": title,
            "handle": YT_HANDLE,
            "source": "rss",
            "videos_fetched": len(videos),
            "total_views": total_views,
            "avg_views": avg_views,
            "top_videos": top,
            "recent_videos": videos[:10]
        }
        
        if args.as_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"📺 {title} ({YT_HANDLE})\n")
            print(f"🎬 Последних видео (RSS): {len(videos)}")
            print(f"👁 Средние просмотры: {avg_views:,}")
            print(f"\n🏆 Топ-{args.top} по просмотрам:")
            for i, v in enumerate(top, 1):
                print(f"  {i}. 👁 {v['views']:,} | 👍 {v['likes']:,} | {v['title'][:55]}")

main()
