"""Tiny SQLite store (stdlib). Only matches, latest event revisions and summary metrics are stored here.
Per-frame tracking goes to ./data/tracking/{matchId}.jsonl.gz, never to SQL."""
from __future__ import annotations
import json
import sqlite3
import threading
import time
from pathlib import Path


class DB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.c = None
        with self.lock:
            self._ensure_conn()

    def _ensure_conn(self):
        if self.c is None:
            self.c = sqlite3.connect(str(self.path), check_same_thread=False)
            self.c.executescript("""
            CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, home TEXT, away TEXT, created REAL);
            CREATE TABLE IF NOT EXISTS events(match_id TEXT, event_id TEXT, revision INT, body TEXT,
                                              PRIMARY KEY(match_id, event_id));
            CREATE TABLE IF NOT EXISTS metrics(match_id TEXT, player_id TEXT, body TEXT, updated REAL,
                                               PRIMARY KEY(match_id, player_id));
            """)
        return self.c

    def upsert_match(self, mid, home, away):
        with self.lock:
            c = self._ensure_conn()
            c.execute("INSERT OR REPLACE INTO matches VALUES(?,?,?,?)", (mid, home, away, time.time())); c.commit()

    def save_event(self, mid, ev):
        with self.lock:
            c = self._ensure_conn()
            c.execute("INSERT OR REPLACE INTO events VALUES(?,?,?,?)",
                      (mid, ev["eventId"], ev["revision"], json.dumps(ev, separators=(",", ":")))); c.commit()

    def save_metrics(self, mid, rows):
        with self.lock:
            c = self._ensure_conn()
            c.executemany("INSERT OR REPLACE INTO metrics VALUES(?,?,?,?)",
                          [(mid, r["id"], json.dumps(r), time.time()) for r in rows]); c.commit()

    def events(self, mid):
        with self.lock:
            c = self._ensure_conn()
            return [json.loads(r[0]) for r in c.execute("SELECT body FROM events WHERE match_id=?", (mid,))]

    def close(self):
        with self.lock:
            if self.c is not None:
                try:
                    self.c.close()
                finally:
                    self.c = None
