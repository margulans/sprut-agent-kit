#!/usr/bin/env python3
"""YouTube Analytics OAuth2 auth - one-time setup.
Uses the same Google OAuth client as gog (calendar)."""
import json
import pickle
import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

SCOPES = [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.readonly"
]
CLIENT_SECRET = os.path.expanduser("~/.config/gog/client_secret.json")
TOKEN_PATH = os.path.expanduser("~/.openclaw/yt-analytics-token.pickle")

def main():
    creds = None
    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
            creds = flow.run_local_server(port=8099, open_browser=False)
        
        with open(TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)
    
    print("✅ YouTube Analytics авторизован!")
    print(f"Токен сохранён: {TOKEN_PATH}")

if __name__ == "__main__":
    main()
