#!/usr/bin/env python3
"""Telegram Telethon auth - one-time setup"""
from telethon import TelegramClient
import asyncio

api_id = 30942990
api_hash = "53e56f4eb2ed7134dc731a78238a7165"
session_path = "~/.openclaw/tg-stats-session"

async def main():
    client = TelegramClient(session_path, api_id, api_hash)
    await client.start(phone="+995599952241")
    me = await client.get_me()
    print(f"✅ Авторизован как: {me.first_name} {me.last_name or ''} (@{me.username})")
    await client.disconnect()

asyncio.run(main())
