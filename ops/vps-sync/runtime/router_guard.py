#!/usr/bin/env python3
"""
Deterministic pre-LLM router guard for Telegram runtime.
Runs before any LLM call and enforces routing/intercepts by fixed scenarios.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class GuardDecision:
    scenario: str
    route: str
    task_type: str = "web_search"
    instructions: str = ""
    reason: str = ""


SOURCE_FOLLOWUP_PATTERNS = [
    re.compile(r"(откуда|какой|какие|где).*(инфо|информация|данные|источник|источники)", re.IGNORECASE),
    re.compile(r"(откуда\s+ты\s+зна(е|ё)шь|как\s+ты\s+узнал|как\s+ты\s+это\s+узнал|как\s+тебе\s+это\s+известно)", re.IGNORECASE),
    re.compile(r"(кто\s+тебе\s+сказал|кто\s+это\s+сказал)", re.IGNORECASE),
    re.compile(r"(source|sources|provenance|citation|citations)", re.IGNORECASE),
]

EXPLICIT_SCOUT_PATTERNS = [
    re.compile(r"\b(скаут|scout)\b", re.IGNORECASE),
]

EXPLICIT_SCOUT_ACTIONS = [
    "спроси",
    "спросить",
    "позови",
    "вызови",
    "пусть ответит",
    "через скаута",
    "use scout",
    "ask scout",
    "route to scout",
]

PRODUCT_SELECTION_MARKERS = [
    "лучший",
    "лучшие",
    "топ",
    "что выбрать",
    "какой выбрать",
    "сравни",
    "сравнение",
    "best",
    "top",
    "which one",
    "recommend",
]

PRODUCT_DOMAIN_MARKERS = [
    "бинокл",
    "тепловиз",
    "прицел",
    "оптик",
    "ноутбук",
    "смартфон",
    "камера",
    "модель",
    "бренд",
    "для охоты",
    "в горах",
    "gear",
    "equipment",
]

FRESH_FACT_MARKERS = [
    "сейчас",
    "на сегодня",
    "последн",
    "новая",
    "новый",
    "официаль",
    "цена",
    "в наличии",
    "latest",
    "current",
    "right now",
    "price",
]


def is_source_followup(text: str) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False
    def has_word(pattern: str) -> bool:
        return re.search(pattern, normalized, re.IGNORECASE) is not None

    has_source_word = any(x in normalized for x in ("источник", "информац", "данн", "source", "citation", "provenance"))
    has_knowledge_word = (
        has_word(r"\bзна(е|ё)шь\b")
        or has_word(r"\bузнал(а|и)?\b")
        or has_word(r"\bкого\b")
        or has_word(r"\bкто\b")
    )
    has_how_word = has_word(r"\bоткуда\b") or has_word(r"\bкак\b") or has_word(r"\bкто\b")
    if has_how_word and (has_source_word or has_knowledge_word):
        return True
    return any(p.search(normalized) for p in SOURCE_FOLLOWUP_PATTERNS)


def is_explicit_scout_request(text: str) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False
    if not any(p.search(normalized) for p in EXPLICIT_SCOUT_PATTERNS):
        return False
    return any(marker in normalized for marker in EXPLICIT_SCOUT_ACTIONS)


def is_product_selection(text: str) -> bool:
    normalized = text.strip().lower()
    return any(x in normalized for x in PRODUCT_SELECTION_MARKERS) and any(x in normalized for x in PRODUCT_DOMAIN_MARKERS)


def is_fresh_fact_query(text: str) -> bool:
    normalized = text.strip().lower()
    has_question = "?" in normalized or normalized.startswith(("какой", "какая", "какие", "что", "кто", "где", "когда", "сколько"))
    return has_question and any(x in normalized for x in FRESH_FACT_MARKERS)


def decide(text: str, has_image: bool, has_voice: bool) -> Optional[GuardDecision]:
    if has_image or has_voice:
        return None

    if is_source_followup(text):
        return GuardDecision(
            scenario="source_followup",
            route="intercept_source",
            reason="Source/provenance follow-up should bypass LLM fallback.",
        )

    if is_explicit_scout_request(text):
        return GuardDecision(
            scenario="explicit_scout",
            route="force_scout",
            task_type="web_search",
            instructions="User explicitly requested Scout. Search web and return expanded answer with one best source.",
            reason="Explicit Scout mention with action marker.",
        )

    if is_product_selection(text):
        return GuardDecision(
            scenario="product_selection",
            route="force_scout",
            task_type="web_search",
            instructions="Find up-to-date product comparison data and return expanded recommendation with one best source.",
            reason="Selection/comparison query over products.",
        )

    if is_fresh_fact_query(text):
        return GuardDecision(
            scenario="fresh_fact_query",
            route="force_scout",
            task_type="web_search",
            instructions="Search web for up-to-date factual answer and return expanded response with one best source.",
            reason="Likely fresh factual question.",
        )

    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-b64", required=True)
    parser.add_argument("--has-image", choices=("0", "1"), default="0")
    parser.add_argument("--has-voice", choices=("0", "1"), default="0")
    args = parser.parse_args()

    text = base64.b64decode(args.text_b64).decode("utf-8", errors="replace")
    decision = decide(text=text, has_image=args.has_image == "1", has_voice=args.has_voice == "1")
    if not decision:
        print(json.dumps({"matched": False}, ensure_ascii=False))
        return 0

    print(
        json.dumps(
            {
                "matched": True,
                "scenario": decision.scenario,
                "route": decision.route,
                "task_type": decision.task_type,
                "instructions": decision.instructions,
                "reason": decision.reason,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
