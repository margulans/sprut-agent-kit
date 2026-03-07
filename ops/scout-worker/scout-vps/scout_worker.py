#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import traceback
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


BASE_DIR = Path(os.getenv("SCOUT_BASE_DIR", "/srv/scout"))
INBOX_DIR = BASE_DIR / "inbox" / "requests"
PROCESSED_DIR = BASE_DIR / "processed"
ERROR_DIR = BASE_DIR / "error"
OUTBOX_RAW_DIR = BASE_DIR / "outbox" / "raw"
STATE_DIR = BASE_DIR / "state"
LOG_DIR = Path(os.getenv("SCOUT_LOG_DIR", "/var/log/scout"))
STATE_FILE = STATE_DIR / "state.json"
EVENTS_FILE = STATE_DIR / "events.jsonl"

SCHEMA_VERSION = "1.0"
SOURCE_BOT = "scout"

TASK_WEATHER = "weather_lookup"
TASK_WEB_SEARCH = "web_search"
TASK_DEEP_RESEARCH = "deep_research"
TASK_REDDIT_SCAN = "reddit_scan"
TASK_YOUTUBE_TRANSCRIBE = "youtube_transcribe"
TASK_YOUTUBE_SEARCH = "youtube_search"
TASK_SOCIAL_SEARCH = "social_search"
TASK_MESSENGER_CHANNELS_SEARCH = "messenger_channels_search"
TASK_SUMMARIZE = "summarize_text"
TASK_ANALYZE = "analyze_topic"
TASK_SKILLS_CATALOG = "skills_catalog"
TASK_WEB_RESEARCH = "web_research"  # backward compatibility alias

SUPPORTED_TASKS = {
    TASK_WEATHER,
    TASK_WEB_SEARCH,
    TASK_DEEP_RESEARCH,
    TASK_REDDIT_SCAN,
    TASK_YOUTUBE_TRANSCRIBE,
    TASK_YOUTUBE_SEARCH,
    TASK_SOCIAL_SEARCH,
    TASK_MESSENGER_CHANNELS_SEARCH,
    TASK_SUMMARIZE,
    TASK_ANALYZE,
    TASK_SKILLS_CATALOG,
    TASK_WEB_RESEARCH,
}

SKILLS_CATALOG = [
    {
        "id": "weather_lookup",
        "name": "Weather Lookup",
        "task_type": TASK_WEATHER,
        "description": "Погода и метрики через wttr.in",
    },
    {
        "id": "web_search",
        "name": "Web Search",
        "task_type": TASK_WEB_SEARCH,
        "description": "Поиск в сети (DuckDuckGo HTML) с выдачей ссылок и сниппетов",
    },
    {
        "id": "deep_research",
        "name": "Deep Research",
        "task_type": TASK_DEEP_RESEARCH,
        "description": "Мультизапросный ресерч с fetch топ-страниц и итоговым саммари",
    },
    {
        "id": "reddit_scan",
        "name": "Reddit Scan",
        "task_type": TASK_REDDIT_SCAN,
        "description": "Поиск обсуждений в Reddit и агрегация сигналов",
    },
    {
        "id": "youtube_transcribe",
        "name": "YouTube Transcribe",
        "task_type": TASK_YOUTUBE_TRANSCRIBE,
        "description": "Транскрипт видео YouTube и краткое summary",
    },
    {
        "id": "youtube_search",
        "name": "YouTube Search",
        "task_type": TASK_YOUTUBE_SEARCH,
        "description": "Поиск YouTube-видео и каналов по теме",
    },
    {
        "id": "social_search",
        "name": "Social Search",
        "task_type": TASK_SOCIAL_SEARCH,
        "description": "Поиск по соцсетям (X/LinkedIn/Reddit) через web-index",
    },
    {
        "id": "messenger_channels_search",
        "name": "Messenger Channels Search",
        "task_type": TASK_MESSENGER_CHANNELS_SEARCH,
        "description": "Поиск каналов в мессенджерах (Telegram/Discord) по теме",
    },
    {
        "id": "summarize_text",
        "name": "Summarizer",
        "task_type": TASK_SUMMARIZE,
        "description": "Выжимка длинного текста в компактное summary",
    },
    {
        "id": "analyze_topic",
        "name": "Trend Analyzer",
        "task_type": TASK_ANALYZE,
        "description": "Сквозной анализ темы по web+reddit и выделение паттернов",
    },
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_dirs() -> None:
    for p in [INBOX_DIR, PROCESSED_DIR, ERROR_DIR, OUTBOX_RAW_DIR, STATE_DIR, LOG_DIR]:
        p.mkdir(parents=True, exist_ok=True)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def sha256_prefixed(text: str) -> str:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def summarize_error(exc: BaseException) -> str:
    msg = str(exc).strip()
    return msg if msg else exc.__class__.__name__


def http_get(url: str, timeout: int = 20, user_agent: str = "scout-worker/2.0") -> str:
    req = Request(url, headers={"User-Agent": user_agent})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def strip_html(raw_html: str) -> str:
    # Убираем script/style и грубо очищаем HTML до текста.
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw_html)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", text)
    out: List[str] = []
    for p in parts:
        p = p.strip()
        if len(p) >= 20:
            out.append(p)
    return out


def summarize_text(text: str, max_sentences: int = 4) -> str:
    sentences = split_sentences(text)
    if not sentences:
        return (text[:400] + "...") if len(text) > 400 else text
    if len(sentences) <= max_sentences:
        return " ".join(sentences)
    return " ".join(sentences[:max_sentences])


def normalize_city(query: str) -> str:
    q = query.strip()
    q = re.sub(r"^/weather\s+", "", q, flags=re.IGNORECASE)
    q = re.sub(r"^погод[ауеы]\s+в\s+", "", q, flags=re.IGNORECASE)
    q = re.sub(r"^weather\s+in\s+", "", q, flags=re.IGNORECASE)
    return q if q else "Almaty"


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def weather_lookup(query: str) -> Dict[str, Any]:
    city = normalize_city(query)
    url = f"https://wttr.in/{quote(city)}?format=j1"
    body = http_get(url)
    doc = json.loads(body)

    current = (doc.get("current_condition") or [{}])[0]
    nearest = (doc.get("nearest_area") or [{}])[0]
    area_name = ((nearest.get("areaName") or [{}])[0].get("value") or city).strip()
    weather_desc = ((current.get("weatherDesc") or [{}])[0].get("value") or "").strip()

    temp_c = to_float(current.get("temp_C"))
    wind_kmph = to_float(current.get("windspeedKmph"))
    wind_m_s = round((wind_kmph or 0.0) / 3.6, 1) if wind_kmph is not None else None
    humidity = to_float(current.get("humidity"))

    summary_parts = [f"{area_name}"]
    if weather_desc:
        summary_parts.append(weather_desc)
    if temp_c is not None:
        summary_parts.append(f"{temp_c:.0f}°C")
    if wind_m_s is not None:
        summary_parts.append(f"ветер {wind_m_s:.1f} м/с")
    if humidity is not None:
        summary_parts.append(f"влажность {humidity:.0f}%")

    return {
        "summary": ", ".join(summary_parts),
        "location": area_name,
        "temperature_c": temp_c,
        "wind_m_s": wind_m_s,
        "humidity_pct": humidity,
        "citations": ["https://wttr.in/"],
    }


def _decode_duckduckgo_url(url: str) -> str:
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlparse(url)
    if parsed.path == "/l/" and parsed.query:
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return target or url
    return url


def web_search(query: str, max_results: int = 8) -> Dict[str, Any]:
    url = f"https://duckduckgo.com/html/?q={quote(query)}"
    raw = http_get(url, user_agent="Mozilla/5.0 (ScoutWorker)")

    pattern = re.compile(
        r'(?is)<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>'
    )
    results: List[Dict[str, str]] = []
    for match in pattern.finditer(raw):
        href, title_html, snippet_html = match.groups()
        result_url = _decode_duckduckgo_url(html.unescape(href))
        title = strip_html(title_html)
        snippet = strip_html(snippet_html)
        if not result_url.startswith("http"):
            continue
        results.append({"title": title, "url": result_url, "snippet": snippet})
        if len(results) >= max_results:
            break

    summary = f"Найдено {len(results)} результатов по запросу: {query}"
    return {"summary": summary, "query": query, "results": results, "citations": [r["url"] for r in results]}


def dedupe_results(items: List[Dict[str, Any]], max_results: int) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for item in items:
        url = str(item.get("url", "")).strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(item)
        if len(out) >= max_results:
            break
    return out


def youtube_search(query: str, max_results: int = 10) -> Dict[str, Any]:
    q = f"site:youtube.com {query}"
    base = web_search(q, max_results=max_results * 2).get("results", [])
    videos: List[Dict[str, Any]] = []
    channels: List[Dict[str, Any]] = []
    for item in base:
        url = str(item.get("url", ""))
        if "youtube.com/watch" in url or "youtu.be/" in url:
            videos.append(item)
        elif "youtube.com/@" in url or "/channel/" in url or "/c/" in url:
            channels.append(item)

    videos = dedupe_results(videos, max_results)
    channels = dedupe_results(channels, max_results)
    citations = [x["url"] for x in (videos + channels)]
    summary = f"YouTube search: videos={len(videos)}, channels={len(channels)} for '{query}'"
    return {
        "summary": summary,
        "query": query,
        "videos": videos,
        "channels": channels,
        "citations": citations,
    }


def social_search(query: str, max_results: int = 12) -> Dict[str, Any]:
    platform_domains = [
        ("x", "x.com"),
        ("linkedin", "linkedin.com"),
        ("reddit", "reddit.com"),
    ]
    per_platform = max(2, min(6, max_results // len(platform_domains)))
    collected: List[Dict[str, Any]] = []
    for platform, domain in platform_domains:
        rows = web_search(f"site:{domain} {query}", max_results=per_platform).get("results", [])
        for row in rows:
            row = dict(row)
            row["platform"] = platform
            collected.append(row)

    merged = dedupe_results(collected, max_results)
    counts = Counter([str(item.get("platform", "")) for item in merged])
    summary = (
        f"Social search for '{query}': total={len(merged)}, "
        f"x={counts.get('x', 0)}, linkedin={counts.get('linkedin', 0)}, reddit={counts.get('reddit', 0)}"
    )
    return {
        "summary": summary,
        "query": query,
        "results": merged,
        "citations": [x["url"] for x in merged],
    }


def _extract_telegram_handle(url: str) -> Optional[str]:
    m = re.search(r"t\.me/(?:s/)?([A-Za-z0-9_]{4,})", url)
    if not m:
        return None
    handle = m.group(1)
    if handle.lower() in {"joinchat", "share"}:
        return None
    return f"@{handle}"


def messenger_channels_search(query: str, max_results: int = 12) -> Dict[str, Any]:
    collected: List[Dict[str, Any]] = []

    tg_results = web_search(f"site:t.me {query} channel", max_results=max_results).get("results", [])
    for row in tg_results:
        item = dict(row)
        item["platform"] = "telegram"
        item["handle"] = _extract_telegram_handle(str(item.get("url", "")))
        collected.append(item)

    discord_results = web_search(f"site:discord.com/invite {query}", max_results=max_results // 2).get("results", [])
    for row in discord_results:
        item = dict(row)
        item["platform"] = "discord"
        collected.append(item)

    merged = dedupe_results(collected, max_results)
    tg_count = sum(1 for x in merged if x.get("platform") == "telegram")
    dc_count = sum(1 for x in merged if x.get("platform") == "discord")
    summary = f"Messenger channels search '{query}': telegram={tg_count}, discord={dc_count}, total={len(merged)}"
    return {
        "summary": summary,
        "query": query,
        "channels": merged,
        "citations": [x["url"] for x in merged],
    }


def fetch_page_text(url: str, max_chars: int = 12000) -> str:
    raw = http_get(url, timeout=25, user_agent="Mozilla/5.0 (ScoutWorker)")
    return strip_html(raw)[:max_chars]


def deep_research(query: str, max_queries: int = 4, fetch_top: int = 4) -> Dict[str, Any]:
    subqueries = [query, f"{query} latest", f"{query} analysis", f"{query} trends 2026"]
    subqueries = subqueries[:max_queries]

    aggregated: List[Dict[str, str]] = []
    seen_urls = set()
    for sq in subqueries:
        chunk = web_search(sq, max_results=6).get("results", [])
        for item in chunk:
            u = item.get("url", "")
            if not u or u in seen_urls:
                continue
            seen_urls.add(u)
            aggregated.append(item)

    deep_reads: List[Dict[str, Any]] = []
    for item in aggregated[:fetch_top]:
        try:
            page_text = fetch_page_text(item["url"])
            deep_reads.append(
                {
                    "title": item["title"],
                    "url": item["url"],
                    "summary": summarize_text(page_text, max_sentences=3),
                }
            )
        except Exception:
            continue

    combined = " ".join(d.get("summary", "") for d in deep_reads).strip()
    final_summary = summarize_text(combined, max_sentences=5) if combined else f"Собраны источники по теме: {query}"
    return {
        "summary": final_summary,
        "query": query,
        "subqueries": subqueries,
        "source_count": len(aggregated),
        "deep_reads": deep_reads,
        "citations": [d["url"] for d in deep_reads],
    }


def reddit_scan(query: str, limit: int = 10) -> Dict[str, Any]:
    url = f"https://www.reddit.com/search.json?q={quote(query)}&sort=top&t=month&limit={limit}"
    raw = http_get(url, user_agent="scout-worker/2.0 reddit-scan")
    doc = json.loads(raw)
    children = (((doc.get("data") or {}).get("children")) or [])
    posts: List[Dict[str, Any]] = []
    for child in children:
        data = child.get("data") or {}
        permalink = data.get("permalink") or ""
        post_url = f"https://reddit.com{permalink}" if permalink else (data.get("url") or "")
        posts.append(
            {
                "subreddit": data.get("subreddit"),
                "title": data.get("title"),
                "score": data.get("score"),
                "num_comments": data.get("num_comments"),
                "url": post_url,
            }
        )

    top_subs = Counter([p.get("subreddit") for p in posts if p.get("subreddit")]).most_common(3)
    summary = f"Найдено {len(posts)} reddit-постов; топ сабреддиты: {', '.join(s for s, _ in top_subs) if top_subs else 'нет данных'}"
    return {"summary": summary, "query": query, "posts": posts, "citations": [p["url"] for p in posts if p.get("url")]}


def extract_youtube_video_id(text: str) -> str:
    text = text.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        return text
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", text)
    if m:
        return m.group(1)
    raise ValueError("cannot extract youtube video id")


def youtube_transcribe(query: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    video_id = extract_youtube_video_id(query)
    langs = payload.get("languages") or ["ru", "en"]
    if not isinstance(langs, list):
        langs = ["ru", "en"]

    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            f"youtube_transcript_api not available: {exc}. Install it on Scout VPS."
        ) from exc

    transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=langs)
    text = " ".join([str(chunk.get("text", "")).strip() for chunk in transcript]).strip()
    text = re.sub(r"\s+", " ", text)
    summary = summarize_text(text, max_sentences=5)
    return {
        "summary": summary or "Транскрипт получен, но текст пуст.",
        "video_id": video_id,
        "transcript_len_chars": len(text),
        "transcript_preview": text[:1200],
        "citations": [f"https://www.youtube.com/watch?v={video_id}"],
    }


def summarize_payload(payload: Dict[str, Any], query: str) -> Dict[str, Any]:
    input_text = str(payload.get("input_text") or query or "").strip()
    if not input_text:
        raise ValueError("input_text/query is empty")
    summary = summarize_text(input_text, max_sentences=6)
    return {"summary": summary, "input_len_chars": len(input_text), "citations": []}


def analyze_topic(query: str) -> Dict[str, Any]:
    web = web_search(query, max_results=8)
    reddit = reddit_scan(query, limit=8)
    bag = " ".join([query] + [r.get("title", "") + " " + r.get("snippet", "") for r in web.get("results", [])])
    tokens = [t.lower() for t in re.findall(r"[A-Za-zА-Яа-я0-9_-]{4,}", bag)]
    stop = {"with", "that", "this", "from", "what", "about", "news", "latest", "have", "your", "https"}
    top_keywords = [w for w, _ in Counter([t for t in tokens if t not in stop]).most_common(10)]
    summary = (
        f"Анализ темы '{query}': web={len(web.get('results', []))} источников, "
        f"reddit={len(reddit.get('posts', []))} постов. Ключевые слова: {', '.join(top_keywords[:6]) or 'нет'}."
    )
    citations = web.get("citations", [])[:6] + reddit.get("citations", [])[:6]
    return {
        "summary": summary,
        "query": query,
        "top_keywords": top_keywords,
        "web_sample": web.get("results", [])[:5],
        "reddit_sample": reddit.get("posts", [])[:5],
        "citations": citations,
    }


@dataclass
class ScoutJob:
    request_id: str
    task_type: str
    query: str
    payload: Dict[str, Any]


def parse_job(payload: Dict[str, Any]) -> ScoutJob:
    request_id = str(payload.get("request_id", "")).strip()
    task_type = str(payload.get("task_type", "")).strip()
    query = str(payload.get("query", "")).strip()

    if not request_id:
        raise ValueError("missing request_id")
    if task_type not in SUPPORTED_TASKS:
        raise ValueError(f"unsupported task_type: {task_type}")
    if task_type != TASK_SKILLS_CATALOG and not query and not payload.get("input_text"):
        raise ValueError("missing query")

    return ScoutJob(request_id=request_id, task_type=task_type, query=query, payload=payload)


def dispatch_task(job: ScoutJob) -> Dict[str, Any]:
    if job.task_type == TASK_WEATHER:
        return weather_lookup(job.query)
    if job.task_type in {TASK_WEB_SEARCH, TASK_WEB_RESEARCH}:
        max_results = int(job.payload.get("max_results", 8))
        return web_search(job.query, max_results=max(1, min(max_results, 20)))
    if job.task_type == TASK_YOUTUBE_SEARCH:
        max_results = int(job.payload.get("max_results", 10))
        return youtube_search(job.query, max_results=max(1, min(max_results, 25)))
    if job.task_type == TASK_SOCIAL_SEARCH:
        max_results = int(job.payload.get("max_results", 12))
        return social_search(job.query, max_results=max(1, min(max_results, 30)))
    if job.task_type == TASK_MESSENGER_CHANNELS_SEARCH:
        max_results = int(job.payload.get("max_results", 12))
        return messenger_channels_search(job.query, max_results=max(1, min(max_results, 30)))
    if job.task_type == TASK_DEEP_RESEARCH:
        max_queries = int(job.payload.get("max_queries", 4))
        fetch_top = int(job.payload.get("fetch_top", 4))
        return deep_research(job.query, max_queries=max(1, min(max_queries, 8)), fetch_top=max(1, min(fetch_top, 8)))
    if job.task_type == TASK_REDDIT_SCAN:
        limit = int(job.payload.get("limit", 10))
        return reddit_scan(job.query, limit=max(1, min(limit, 25)))
    if job.task_type == TASK_YOUTUBE_TRANSCRIBE:
        return youtube_transcribe(job.query, job.payload)
    if job.task_type == TASK_SUMMARIZE:
        return summarize_payload(job.payload, job.query)
    if job.task_type == TASK_ANALYZE:
        return analyze_topic(job.query)
    if job.task_type == TASK_SKILLS_CATALOG:
        return {"summary": "Каталог скиллов Scout", "skills": SKILLS_CATALOG, "citations": []}
    raise ValueError(f"unsupported task_type: {job.task_type}")


def build_ok_response(job: ScoutJob, result: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "request_id": job.request_id,
        "task_type": job.task_type,
        "source_bot": SOURCE_BOT,
        "created_at": utc_now_iso(),
        "observed_at": utc_now_iso(),
        "status": "ok",
        "result": result,
        "confidence": 0.8,
        "ttl_sec": int(job.payload.get("ttl_sec", 1800)),
    }
    payload["hash"] = sha256_prefixed(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return payload


def build_error_response(job: ScoutJob, message: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "request_id": job.request_id,
        "task_type": job.task_type,
        "source_bot": SOURCE_BOT,
        "created_at": utc_now_iso(),
        "observed_at": utc_now_iso(),
        "status": "error",
        "error_message": message,
        "confidence": 0.0,
        "ttl_sec": 300,
    }
    payload["hash"] = sha256_prefixed(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return payload


def write_response(job: ScoutJob, payload: Dict[str, Any]) -> Path:
    target = OUTBOX_RAW_DIR / f"scout-{job.request_id}.json"
    write_json(target, payload)
    return target


def move_file(src: Path, dst_dir: Path) -> Path:
    dst = dst_dir / src.name
    src.replace(dst)
    return dst


def update_state(event: Dict[str, Any]) -> None:
    state = load_json(STATE_FILE, default={"processed_total": 0, "last_event_at": None})
    state["processed_total"] = int(state.get("processed_total", 0)) + 1
    state["last_event_at"] = event.get("ts")
    write_json(STATE_FILE, state)
    append_jsonl(EVENTS_FILE, event)


def process_one_file(path: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    job = parse_job(raw)
    response_path: Optional[Path] = None

    try:
        result = dispatch_task(job)
        response = build_ok_response(job, result)
        response_path = write_response(job, response)
        moved = move_file(path, PROCESSED_DIR)
        update_state(
            {
                "ts": utc_now_iso(),
                "status": "ok",
                "request_id": job.request_id,
                "task_type": job.task_type,
                "request_file": str(moved),
                "response_file": str(response_path),
            }
        )
    except Exception as exc:
        err_text = summarize_error(exc)
        response = build_error_response(job, err_text)
        response_path = write_response(job, response)
        moved = move_file(path, ERROR_DIR)
        update_state(
            {
                "ts": utc_now_iso(),
                "status": "error",
                "request_id": job.request_id,
                "task_type": job.task_type,
                "request_file": str(moved),
                "response_file": str(response_path),
                "error": err_text,
            }
        )


def process_pending(limit: int) -> int:
    files = sorted(INBOX_DIR.glob("*.json"))
    processed = 0
    for file_path in files:
        if processed >= limit:
            break
        process_one_file(file_path)
        processed += 1
    return processed


def run_scheduled_scan() -> Dict[str, Any]:
    ts = utc_now_iso()
    # Базовый weekly scan: короткий deep_research по ключевым трекам.
    tracks = [
        "AI agents 2026",
        "robotics breakthroughs 2026",
        "eVTOL market updates 2026",
        "youtube ai tools trends",
    ]
    artifacts: List[Dict[str, Any]] = []
    citations: List[str] = []
    for tr in tracks:
        try:
            item = deep_research(tr, max_queries=2, fetch_top=2)
            artifacts.append({"track": tr, "summary": item.get("summary", "")})
            citations.extend(item.get("citations", []))
        except Exception as exc:
            artifacts.append({"track": tr, "summary": f"error: {summarize_error(exc)}"})

    report = {
        "schema_version": SCHEMA_VERSION,
        "request_id": f"scheduled-{int(datetime.now(timezone.utc).timestamp())}",
        "task_type": TASK_DEEP_RESEARCH,
        "source_bot": SOURCE_BOT,
        "created_at": ts,
        "observed_at": ts,
        "status": "ok",
        "result": {
            "summary": "Scheduled scout scan completed across core tracks.",
            "tracks": artifacts,
            "citations": citations[:20],
        },
        "confidence": 0.6,
        "ttl_sec": 86400,
    }
    report["hash"] = sha256_prefixed(json.dumps(report, ensure_ascii=False, sort_keys=True))
    out = OUTBOX_RAW_DIR / f"scout-scheduled-{int(datetime.now(timezone.utc).timestamp())}.json"
    write_json(out, report)
    update_state(
        {
            "ts": ts,
            "status": "ok",
            "request_id": report["request_id"],
            "task_type": TASK_DEEP_RESEARCH,
            "request_file": None,
            "response_file": str(out),
            "note": "scheduled_scan",
        }
    )
    return report


def log_crash(exc: BaseException) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    crash_file = LOG_DIR / "scout-worker-crash.log"
    with crash_file.open("a", encoding="utf-8") as f:
        f.write(f"[{utc_now_iso()}] {summarize_error(exc)}\n")
        f.write(traceback.format_exc())
        f.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Scout worker service")
    parser.add_argument("--mode", choices=["poll", "scheduled"], default="poll")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    ensure_dirs()
    if args.mode == "poll":
        processed = process_pending(limit=max(1, args.limit))
        print(f"processed={processed}")
        return 0

    run_scheduled_scan()
    print("scheduled_scan=ok")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log_crash(exc)
        print(summarize_error(exc), file=sys.stderr)
        raise
