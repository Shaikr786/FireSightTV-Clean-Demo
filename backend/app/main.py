from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("FIRESIGHT_DB_PATH", str(DATA_DIR / "firesight-live.sqlite3")))

app = FastAPI(title="FireSightTV Real-Time API", version="2.0.0", description="Real video stream tracking API. No seeded match or event data.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def seed_db() -> None:
    with closing(connect()) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, sport TEXT NOT NULL, venue TEXT,
            duration_seconds INTEGER NOT NULL, status TEXT NOT NULL,
            home_name TEXT NOT NULL, home_short TEXT NOT NULL, away_name TEXT NOT NULL, away_short TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL, timestamp_seconds INTEGER NOT NULL,
            event_type TEXT NOT NULL, description TEXT NOT NULL, importance INTEGER NOT NULL,
            score_home_after INTEGER NOT NULL, score_away_after INTEGER NOT NULL, player_name TEXT
        );
        CREATE TABLE IF NOT EXISTS highlights (
            id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL, event_id INTEGER,
            timestamp_seconds INTEGER NOT NULL, duration_seconds INTEGER NOT NULL,
            title TEXT NOT NULL, description TEXT NOT NULL, importance INTEGER NOT NULL
        );
        """)
        exists = db.execute("SELECT id FROM matches WHERE id=1").fetchone()
        if exists:
            return
        db.execute("INSERT INTO matches VALUES (1,?,?,?,?,?,?,?,?,?)", (
            "North City vs South United", "Football", "Demo Arena", 5400, "LIVE",
            "North City", "NCT", "South United", "SOU"
        ))
        events = [
            (1,1,135,"chance","North City creates a dangerous chance down the right wing.",6,0,0,"A. Silva"),
            (2,1,360,"goal","GOAL! North City finishes a quick attacking move.",10,1,0,"A. Silva"),
            (3,1,450,"save","A sharp save keeps South United in the match.",8,1,0,"M. Reed"),
            (4,1,780,"yellow_card","A yellow card is shown after a late challenge.",5,1,0,"J. Cole"),
            (5,1,1110,"goal","GOAL! South United equalizes from a set piece.",10,1,1,"R. Khan"),
            (6,1,1680,"chance","A close-range effort flashes just wide.",7,1,1,"L. Park"),
            (7,1,2250,"save","The goalkeeper makes a one-handed stop.",8,1,1,"M. Reed"),
            (8,1,2760,"goal","GOAL! North City retakes the lead on the counter.",10,2,1,"D. James"),
            (9,1,3210,"substitution","Fresh legs arrive for South United.",4,2,1,"T. Evans"),
            (10,1,3880,"chance","South United nearly finds a late equalizer.",7,2,1,"R. Khan"),
        ]
        db.executemany("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)", events)
        highlights = [
            (1,1,2,360,18,"North City opener","A fast move ends with Silva finishing for the opener.",10),
            (2,1,3,450,14,"Huge goalkeeper save","Reed reacts quickly to keep the lead intact.",8),
            (3,1,5,1110,20,"South United equalizer","Khan scores from a set piece to level the match.",10),
            (4,1,7,2250,15,"One-handed stop","A spectacular save prevents a goal.",8),
            (5,1,8,2760,22,"Counterattack goal","James finishes a rapid counter to restore the lead.",10),
            (6,1,10,3880,16,"Late pressure","South United threatens in the closing stages.",7),
        ]
        db.executemany("INSERT INTO highlights VALUES (?,?,?,?,?,?,?,?)", highlights)
        db.commit()


@app.on_event("startup")
def startup() -> None:
    # Intentionally do not seed fictional match/event/highlight records.
    pass

from .realtime import router as realtime_router
app.include_router(realtime_router)


class AskBody(BaseModel):
    question: str = Field(default="What just happened?", max_length=500)
    timestamp_seconds: int = Field(default=0, ge=0)


def get_match(db: sqlite3.Connection, match_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM matches WHERE id=?", (match_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Match not found. Try match ID 1.")
    return row


def team(row: sqlite3.Row, side: str) -> dict[str, Any]:
    return {"id": 1 if side == "home" else 2, "name": row[f"{side}_name"], "short_name": row[f"{side}_short"]}


def event_out(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "match_id": row["match_id"], "timestamp_seconds": row["timestamp_seconds"],
        "event_type": row["event_type"], "team_id": None, "player_id": None,
        "player_name": row["player_name"], "secondary_player_id": None,
        "description": row["description"], "importance": row["importance"],
        "score_home_after": row["score_home_after"], "score_away_after": row["score_away_after"], "metadata": {}
    }


def highlight_out(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "match_id": row["match_id"], "event_id": row["event_id"],
            "timestamp_seconds": row["timestamp_seconds"], "duration_seconds": row["duration_seconds"],
            "title": row["title"], "description": row["description"], "importance": row["importance"]}


def score_at(db: sqlite3.Connection, match_id: int, timestamp: int) -> tuple[int, int]:
    row = db.execute("SELECT score_home_after, score_away_after FROM events WHERE match_id=? AND timestamp_seconds<=? ORDER BY timestamp_seconds DESC LIMIT 1", (match_id, timestamp)).fetchone()
    return (row[0], row[1]) if row else (0, 0)


@app.get("/")
def root():
    return {"service": "FireSightTV Real-Time API", "status": "ok", "docs": "/docs", "health": "/health", "tracking": "/api/v1/live/status"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "firesight-api", "database": "sqlite", "seeded": False, "tracking": "available"}

@app.get("/api/v1/ai/status")
def ai_status():
    return {
        "available": False,
        "mode": "computer-vision-only",
        "message": "No generative AI or match-event recognition is integrated. Live endpoints expose model detections only.",
    }

@app.get("/api/v1/matches/{match_id}")
def read_match(match_id: int):
    with closing(connect()) as db:
        m = get_match(db, match_id)
        return {"id": m["id"], "title": m["title"], "sport": m["sport"], "venue": m["venue"],
                "duration_seconds": m["duration_seconds"], "status": m["status"],
                "home_team": team(m, "home"), "away_team": team(m, "away"), "metadata": {"demo": True}}

@app.get("/api/v1/matches/{match_id}/events")
def list_events(match_id: int, event_type: str | None = None, min_importance: int | None = None):
    with closing(connect()) as db:
        get_match(db, match_id)
        sql = "SELECT * FROM events WHERE match_id=?"
        params: list[Any] = [match_id]
        if event_type:
            sql += " AND event_type=?"; params.append(event_type)
        if min_importance is not None:
            sql += " AND importance>=?"; params.append(min_importance)
        sql += " ORDER BY timestamp_seconds"
        return [event_out(r) for r in db.execute(sql, params).fetchall()]

@app.get("/api/v1/matches/{match_id}/highlights")
def list_highlights(match_id: int):
    with closing(connect()) as db:
        get_match(db, match_id)
        rows = db.execute("SELECT * FROM highlights WHERE match_id=? ORDER BY importance DESC, timestamp_seconds", (match_id,)).fetchall()
        return [highlight_out(r) for r in rows]

@app.get("/api/v1/matches/{match_id}/context")
def read_context(match_id: int, timestamp_seconds: int = Query(0, ge=0)):
    with closing(connect()) as db:
        m = get_match(db, match_id)
        events = db.execute("SELECT * FROM events WHERE match_id=? AND timestamp_seconds<=? ORDER BY timestamp_seconds DESC LIMIT 3", (match_id, timestamp_seconds)).fetchall()
        highlights = db.execute("SELECT * FROM highlights WHERE match_id=? AND ABS(timestamp_seconds-?)<=180 ORDER BY importance DESC LIMIT 3", (match_id, timestamp_seconds)).fetchall()
        sh, sa = score_at(db, match_id, timestamp_seconds)
        return {"match_id": match_id, "timestamp_seconds": timestamp_seconds, "score": {"home": sh, "away": sa},
                "match_status": m["status"], "recent_events": [event_out(r) for r in reversed(events)],
                "nearby_highlights": [highlight_out(r) for r in highlights], "current_players_hint": [],
                "home_team": team(m, "home"), "away_team": team(m, "away")}

@app.get("/api/v1/matches/{match_id}/next-big-moment")
def next_big_moment(match_id: int, after_seconds: int = Query(0, ge=0), min_importance: int = Query(7, ge=1, le=10)):
    with closing(connect()) as db:
        get_match(db, match_id)
        row = db.execute("SELECT * FROM events WHERE match_id=? AND timestamp_seconds>? AND importance>=? ORDER BY timestamp_seconds LIMIT 1", (match_id, after_seconds, min_importance)).fetchone()
        return event_out(row) if row else None

@app.post("/api/v1/matches/{match_id}/ai/ask")
def ai_ask(match_id: int, body: AskBody):
    with closing(connect()) as db:
        m = get_match(db, match_id)
        nearest = db.execute("SELECT * FROM events WHERE match_id=? ORDER BY ABS(timestamp_seconds-?) LIMIT 1", (match_id, body.timestamp_seconds)).fetchone()
        sh, sa = score_at(db, match_id, body.timestamp_seconds)
        if nearest and abs(nearest["timestamp_seconds"] - body.timestamp_seconds) <= 180:
            answer = f"{nearest['description']} The demo scoreboard at this point is {m['home_short']} {sh}–{sa} {m['away_short']}."
            related = [nearest["id"]]
            seek = nearest["timestamp_seconds"]
        else:
            answer = f"At this point in the demo timeline, {m['home_name']} and {m['away_name']} are {sh}–{sa}. Try a highlight or jump to the next big moment for more context."
            related = []
            seek = None
        if "defend" in body.question.lower() or "why" in body.question.lower():
            answer += " This explanation is based on the seeded event timeline, not live computer-vision analysis."
        actions = ([{"type": "seek", "timestamp_seconds": seek, "label": "Jump to this moment"}] if seek is not None else [])
        return {"answer": answer, "related_event_ids": related, "suggested_actions": actions, "context_used": None}

@app.post("/api/v1/matches/{match_id}/ai/recap")
def ai_recap(match_id: int, body: AskBody):
    with closing(connect()) as db:
        m = get_match(db, match_id)
        rows = db.execute("SELECT * FROM events WHERE match_id=? AND timestamp_seconds<=? ORDER BY timestamp_seconds", (match_id, body.timestamp_seconds)).fetchall()
        sh, sa = score_at(db, match_id, body.timestamp_seconds)
        goals = [r["description"] for r in rows if r["event_type"] == "goal"]
        notable = [r["description"] for r in rows if r["importance"] >= 8 and r["event_type"] != "goal"]
        parts = [f"Demo recap: {m['home_name']} {sh}–{sa} {m['away_name']}. "]
        if goals: parts.append("Goals: " + " ".join(goals) + " ")
        if notable: parts.append("Other key moments: " + " ".join(notable[:2]) + " ")
        parts.append("This recap is generated from the demo event timeline.")
        return {"answer": "".join(parts), "related_event_ids": [r["id"] for r in rows if r["importance"] >= 8], "suggested_actions": [], "context_used": None}

@app.post("/api/v1/matches/{match_id}/highlights/search")
def search_highlights(match_id: int, body: dict[str, Any]):
    q = str(body.get("query", "")).strip().lower()
    with closing(connect()) as db:
        get_match(db, match_id)
        rows = db.execute("SELECT * FROM highlights WHERE match_id=? ORDER BY importance DESC", (match_id,)).fetchall()
        return [highlight_out(r) for r in rows if q in (r["title"] + " " + r["description"]).lower()]

from pathlib import Path
from fastapi.responses import FileResponse

@app.get("/api/v1/live/video")
def get_live_video():
    video_path = (
        Path(__file__).resolve().parent.parent
        / "data"
        / "videos"
        / "f8d51dc8dc444ae4a2e18f1c283f73d9.webm"
    )
    if not video_path.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Football video not found")
    return FileResponse(video_path, media_type="video/webm", filename="football-test.webm")
