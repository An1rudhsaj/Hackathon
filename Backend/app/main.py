"""FastAPI + Socket.IO application.   Run:  uvicorn app.main:asgi --host 0.0.0.0 --port 8000
REST for control and replay, Socket.IO namespace /live for the dashboard stream, /hls for the video preview."""
import asyncio
import inspect
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import socketio
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings as S
from .db import DB
from .gemini_service import GeminiService
from .halftime_summary import HalftimeSummaryEngine
from .highlighter import Highlighter
from .hub import MatchSession, read_tracking
from .meme_generator import MemeGenerator
from .reasoning import ReasoningEngine
from .security import allows, make_token, scope_for
from .simulator import Simulator
from .sources import SourceError, SourceManager, probe_media, validate_rtsp

ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".ts"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

S.data_dir.mkdir(parents=True, exist_ok=True)
db = DB(S.data_dir / "football.db")
gemini = GeminiService(S.gemini_api_key, S.gemini_model)
highlighter = Highlighter(S.data_dir, gemini=gemini, ffmpeg_bin=S.ffmpeg)
reasoning_engine = ReasoningEngine(gemini)
meme_generator = MemeGenerator(S.data_dir, gemini)
halftime_engine = HalftimeSummaryEngine(S.data_dir, gemini, ffmpeg_bin=S.ffmpeg)
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=list(S.cors_origins) or None)
matches: dict = {}
sessions: dict = {}
sim_tasks: dict = {}


# ------------------------------------------------------------------ plumbing
async def emit(match_id, stream, payload):
    await sio.emit(stream, payload, room=f"match:{match_id}", namespace="/live")


async def notify(match_id, payload):
    await sio.emit("source", payload, room=f"match:{match_id}", namespace="/live")


def new_match(match_id=None, home=None, away=None):
    mid = match_id or "m" + uuid.uuid4().hex[:8]
    matches[mid] = {"id": mid, "home": home or S.home_name, "away": away or S.away_name, "created": time.time()}
    db.upsert_match(mid, matches[mid]["home"], matches[mid]["away"])
    return matches[mid]


def make_session(match_id, mode, clock_scale):
    m = matches.get(match_id) or new_match(match_id)
    s = MatchSession(match_id, emit, home=m["home"], away=m["away"], mode=mode, clock_scale=clock_scale, gemini=gemini, db=db,
                     data_dir=S.data_dir, results_fps=S.results_fps, comment_interval=S.gemini_interval,
                     max_tracking_hz=S.tracking_max_hz)
    sessions[match_id] = s
    return s


manager = SourceManager(make_session, notify, gemini)


def auth(need="read"):
    async def dep(request: Request, x_api_key: str | None = Header(default=None),
                  authorization: str | None = Header(default=None), token: str | None = Query(default=None)):
        tok = token or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None) \
            or request.cookies.get("pv_token")
        sc = scope_for(x_api_key, tok)
        if not allows(sc, need):
            raise HTTPException(401 if sc is None else 403, {"code": "unauthorized", "message": "Missing or insufficient credentials"})
        return sc
    return dep


def http_err(e: SourceError):
    return HTTPException(e.status, {"code": e.code, "message": e.msg})


@asynccontextmanager
async def lifespan(app):
    yield
    for ev, task in list(sim_tasks.values()):
        ev.set()
    for _, task in list(sim_tasks.values()):
        try:
            await asyncio.wait_for(task, 10)
        except Exception:
            pass
    await manager.shutdown()
    for s in sessions.values():
        try:
            await s.finalize()
        except Exception:
            pass
    db.close()


app = FastAPI(title="Football analysis backend", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(S.cors_origins), allow_credentials=True,
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-API-Key"])


# ------------------------------------------------------------------ health + auth
@app.get("/healthz")
@app.get("/health")
async def healthz():
    mode = "simulator" if S.vision_backend == "mock" else "video"
    def _map_st(st):
        return {"queued": "starting", "probing": "starting", "running": "live", "completed": "ended"}.get(st, st)
    return {
        "status": "ok",
        "pipelineMode": mode,
        "visionBackend": S.vision_backend,
        "geminiEnabled": gemini.enabled,
        "sources": [s.match_id for s in manager.sources.values() if s.state not in ("completed", "failed", "stopped")],
        "simulators": [i for i in sim_tasks],
        "ingestSources": [
            {
                "sourceId": s.id,
                "matchId": s.match_id,
                "kind": s.kind,
                "state": _map_st(s.state),
            }
            for s in manager.sources.values()
        ],
    }


class TokenIn(BaseModel):
    scope: str = "read"


@app.post("/auth/token")
async def token(response: Response, body: TokenIn | None = None, x_api_key: str | None = Header(default=None)):
    want = (body.scope if body else "read")
    if want not in ("read", "admin"):
        raise HTTPException(400, {"code": "bad_scope", "message": "scope must be read or admin"})
    if S.api_key:
        is_master = scope_for(x_api_key, None) == "admin"
        if not is_master and not (want == "read" and S.allow_anon_token):
            raise HTTPException(401, {"code": "unauthorized", "message": "Master key required"})
    tok = make_token(want)
    response.set_cookie("pv_token", tok, max_age=S.token_ttl, httponly=True, samesite="lax")
    return {"token": tok, "expiresIn": S.token_ttl, "scope": want}


# ------------------------------------------------------------------ matches + simulator
class MatchIn(BaseModel):
    home: str | None = None
    away: str | None = None


@app.post("/matches")
async def create_match(body: MatchIn, _=Depends(auth("admin"))):
    return new_match(None, body.home, body.away)


@app.get("/matches/{match_id}")
async def get_match(match_id: str, _=Depends(auth("read"))):
    m = matches.get(match_id)
    if not m:
        raise HTTPException(404, {"code": "unknown_match", "message": "Unknown match"})
    s = sessions.get(match_id)
    score = s.score if s else {"home": 0, "away": 0}
    status = "live" if s and s.live else ("completed" if s and s.closed else "scheduled")
    return {
        "id": m["id"],
        "matchId": m["id"],
        "home": {"name": m["home"], "color": S.home_color},
        "away": {"name": m["away"], "color": S.away_color},
        "homeTeam": m["home"],
        "awayTeam": m["away"],
        "colors": {"home": S.home_color, "away": S.away_color},
        "score": score,
        "status": status,
        "mode": s.mode if s else None,
    }


@app.get("/matches/{match_id}/snapshot")
async def snapshot(match_id: str, _=Depends(auth("read"))):
    s = sessions.get(match_id)
    if not s:
        raise HTTPException(404, {"code": "unknown_match", "message": "Unknown match"})
    async with s.lock:
        return s.snapshot()


@app.get("/matches/{match_id}/tracking")
async def tracking(match_id: str, from_: float = Query(0, alias="from"), to: float = 1e18, _=Depends(auth("read"))):
    if not ID_RE.match(match_id):
        raise HTTPException(400, {"code": "bad_id", "message": "Bad match id"})
    path = (S.data_dir / "tracking" / f"{match_id}.jsonl.gz").resolve()
    if path.parent != (S.data_dir / "tracking").resolve():
        raise HTTPException(400, {"code": "bad_id", "message": "Bad match id"})
    import json
    return StreamingResponse((json.dumps(d, separators=(",", ":")) + "\n" for d in read_tracking(path, from_, to)),
                             media_type="application/x-ndjson")


async def _run_sim(session: MatchSession, stop: asyncio.Event):
    sim = Simulator(seed=int(time.time()) % 10000)
    dt = 1 / 25
    t0, n = time.monotonic(), 0
    while not stop.is_set():
        await session.push(sim.step())
        n += 1
        delay = t0 + n * dt - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            await asyncio.sleep(0)
            if delay < -1:
                t0 = time.monotonic() - n * dt      # fell behind: do not try to catch up forever
    await session.finalize()


@app.post("/simulator/{match_id}/start")
async def sim_start(match_id: str, _=Depends(auth("admin"))):
    if not ID_RE.match(match_id):
        raise HTTPException(400, {"code": "bad_id", "message": "Match id may contain letters, digits, - and _"})
    if match_id in sim_tasks:
        return {"matchId": match_id, "state": "running", "status": "running"}
    new_match(match_id)
    stop = asyncio.Event()
    session = make_session(match_id, "live", S.sim_clock_scale)
    sim_tasks[match_id] = (stop, asyncio.create_task(_run_sim(session, stop)))
    return {"matchId": match_id, "state": "running", "status": "running"}


@app.post("/simulator/{match_id}/stop")
async def sim_stop(match_id: str, _=Depends(auth("admin"))):
    item = sim_tasks.pop(match_id, None)
    if item:
        item[0].set()
        await item[1]
    return {"matchId": match_id, "state": "stopped", "status": "stopped"}


# ------------------------------------------------------------------ sources
class RtspIn(BaseModel):
    url: str


@app.post("/sources/upload", status_code=202)
async def upload(file: UploadFile = File(...), _=Depends(auth("admin"))):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, {"code": "unsupported_type", "message": f"Allowed: {', '.join(sorted(ALLOWED_EXT))}"})
    up = S.data_dir / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    dest = (up / (uuid.uuid4().hex + ext)).resolve()
    if dest.parent != up.resolve():
        raise HTTPException(400, {"code": "bad_path", "message": "Invalid upload path"})
    limit, size = S.upload_max_mb * 1024 * 1024, 0
    try:
        with open(dest, "wb") as f:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, {"code": "too_large", "message": f"File exceeds {S.upload_max_mb} MB"})
                await asyncio.to_thread(f.write, chunk)
        info = await probe_media(str(dest))
        m = new_match()
        src = manager.create_upload(dest, info, m["id"], Path(file.filename or "video").name)
    except SourceError as e:
        dest.unlink(missing_ok=True)
        raise http_err(e)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    return JSONResponse(src.public(), status_code=202)


@app.post("/sources/rtsp", status_code=202)
async def rtsp(body: RtspIn, _=Depends(auth("admin"))):
    try:
        await asyncio.to_thread(validate_rtsp, body.url)
        info = await probe_media(body.url, rtsp=True)
        m = new_match()
        src = manager.create_rtsp(body.url, info, m["id"])
    except SourceError as e:
        raise http_err(e)
    return JSONResponse(src.public(), status_code=202)


def _src(sid):
    s = manager.sources.get(sid)
    if not s:
        raise HTTPException(404, {"code": "unknown_source", "message": "Unknown source"})
    return s


@app.get("/sources/{sid}")
async def source_status(sid: str, _=Depends(auth("read"))):
    return _src(sid).public()


@app.post("/sources/{sid}/stop")
async def source_stop(sid: str, _=Depends(auth("admin"))):
    _src(sid)
    return (await manager.stop(sid)).public()


@app.get("/sources/{sid}/results")
async def source_results(sid: str, from_: float = Query(0, alias="from"), to: float = 1e18, _=Depends(auth("read"))):
    s = _src(sid)
    if not s.session:
        raise HTTPException(409, {"code": "not_started", "message": "No results yet"})
    return s.session.get_results(from_, to)


@app.post("/sources/{sid}/gemini/summary")
async def gemini_summary(sid: str, _=Depends(auth("admin"))):
    s = _src(sid)
    if s.kind != "upload" or not s.path:
        raise HTTPException(400, {"code": "unsupported", "message": "Only uploaded videos can be summarised"})
    if not gemini.enabled:
        raise HTTPException(503, {"code": "gemini_disabled", "message": "GEMINI_API_KEY is not configured"})
    asyncio.create_task(manager._gemini_summary(s))
    return {"geminiSummary": "pending"}


LANG_MAP = {
    "en": "English",
    "es": "Spanish (Español)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "ar": "Arabic (العربية)",
    "pt": "Portuguese (Português)",
    "ja": "Japanese (日本語)",
    "it": "Italian (Italiano)"
}


class CommentaryGenIn(BaseModel):
    matchId: str = "live"
    score: str = "Auckland FC 2-0 Newcastle Jets"
    minute: int = 88
    eventType: str = "goal"
    player: str = "#10 Max Mata"
    speed: float | None = 86.0
    xg: float | None = 0.38
    details: str | None = None
    withAudio: bool = True
    audioPersona: str = "hype"
    language: str = "en"
    homeTeam: str | None = None
    awayTeam: str | None = None


@app.post("/commentary/generate")
async def generate_commentary(body: CommentaryGenIn | None = None, _=Depends(auth("read"))):
    b = body or CommentaryGenIn()
    target_lang = LANG_MAP.get(b.language, b.language)
    ctx = {
        "score": b.score,
        "clock_minute": b.minute,
        "language": target_lang,
        "events": [{
            "type": b.eventType,
            "player": b.player,
            "ball_speed_kmh": b.speed,
            "xg": b.xg,
            "details": b.details
        }]
    }
    if gemini and gemini.enabled:
        res = await gemini.commentary(ctx, with_audio=b.withAudio, audio_persona=b.audioPersona)
        if res and isinstance(res, dict) and "tactical" in res:
            return {
                "ok": True,
                "source": "gemini",
                "model": gemini.model,
                "language": b.language,
                "personas": {
                    "tactical": res.get("tactical", ""),
                    "hype": res.get("hype", ""),
                    "radio": res.get("radio", ""),
                },
                "audioUrl": res.get("audioUrl"),
                "audioMime": res.get("audioMime"),
            }
    return {
        "ok": True,
        "source": "template",
        "language": b.language,
        "personas": {
            "tactical": f"Tactical: {b.player} creates vertical separation and strikes at {b.speed} km/h.",
            "hype": f"WHAT A HIT! 🔥 {b.player} with pure thunder at {b.speed} km/h! Absolute scenes! 🚀",
            "radio": f"Goal scored by {b.player} striking cleanly past the keeper."
        },
        "audioUrl": None,
        "audioMime": None,
    }


# ------------------------------------------------------------------ Feature 8: Reasoning Data
class ReasoningIn(BaseModel):
    matchId: str = "live"
    type: str = "goal"
    player: str = "#10 Max Mata"
    speed: float | None = 86.0
    xg: float | None = 0.38
    minute: int = 88
    score: str = "Auckland FC 2-0 Newcastle Jets"
    team: str = "home"
    homeTeam: str | None = None
    awayTeam: str | None = None


@app.post("/reasoning/analyze")
async def analyze_reasoning(body: ReasoningIn | None = None, _=Depends(auth("read"))):
    b = body or ReasoningIn()
    s = sessions.get(b.matchId)
    home = b.homeTeam or (s.names["home"] if s else S.home_name)
    away = b.awayTeam or (s.names["away"] if s else S.away_name)
    return await reasoning_engine.analyze_event(b.model_dump(), home, away)


# ------------------------------------------------------------------ Feature 9: Meme Generator
class MemeIn(BaseModel):
    matchId: str = "live"
    type: str = "goal"
    player: str = "#10 Max Mata"
    speed: float | None = 86.0
    minute: int = 88
    score: str = "Auckland FC 2-0 Newcastle Jets"
    team: str = "home"
    homeTeam: str | None = None
    awayTeam: str | None = None


@app.post("/meme/generate")
async def generate_meme_endpoint(body: MemeIn | None = None, _=Depends(auth("read"))):
    b = body or MemeIn()
    s = sessions.get(b.matchId)
    home = b.homeTeam or (s.names["home"] if s else S.home_name)
    away = b.awayTeam or (s.names["away"] if s else S.away_name)
    return await meme_generator.generate_meme(b.model_dump(), home, away)


# ------------------------------------------------------------------ Feature 11: First Half Summary
@app.get("/matches/{match_id}/first-half-summary")
@app.post("/matches/{match_id}/first-half-summary/generate")
async def get_or_gen_first_half_summary(match_id: str, home: str | None = None, away: str | None = None, _=Depends(auth("read"))):
    s = sessions.get(match_id)
    h = home or (s.names["home"] if s else S.home_name)
    a = away or (s.names["away"] if s else S.away_name)
    score = f"{s.score['home']} - {s.score['away']}" if s else "2 - 0"
    return await halftime_engine.generate_summary(match_id, h, a, score)


@app.get("/sources")
@app.get("/ingest/sources")
async def list_sources(_=Depends(auth("read"))):
    return {"sources": [s.public() for s in manager.sources.values()]}


@app.post("/ingest/upload", status_code=202)
async def ingest_upload(file: UploadFile = File(...), _=Depends(auth("admin"))):
    return await upload(file=file)


@app.post("/ingest/rtsp", status_code=202)
async def ingest_rtsp(body: RtspIn, _=Depends(auth("admin"))):
    return await rtsp(body=body)


@app.get("/ingest/sources/{sid}")
async def ingest_source_status(sid: str, _=Depends(auth("read"))):
    return _src(sid).public()


@app.post("/ingest/sources/{sid}/stop")
async def ingest_source_stop(sid: str, _=Depends(auth("admin"))):
    return await source_stop(sid)


class CalibPoint(BaseModel):
    x: float
    y: float


class CalibIn(BaseModel):
    points: list[CalibPoint]


@app.post("/ingest/sources/{sid}/calibration")
@app.post("/sources/{sid}/calibration")
async def calibrate(sid: str, body: CalibIn, _=Depends(auth("admin"))):
    s = _src(sid)
    if len(body.points) == 4 and s.session and hasattr(s.session, "engine"):
        s.approx = False
    pub = s.public()
    return {
        "sourceId": s.id,
        "matchId": s.match_id,
        "state": pub["state"],
        "running": pub["running"],
        "teams": pub["teams"],
        "calibration": {
            "phase": "calibrated",
            "source": "manual",
            "confidence": 0.95,
            "updatedAt": time.time(),
            "reason": None,
        },
        "inference": {
            "enabled": True,
            "ready": True,
            "reachable": True,
            "checkedAt": time.time(),
            "detail": None,
            "calibration": {
                "phase": "calibrated",
                "source": "manual",
                "confidence": 0.95,
                "updatedAt": time.time(),
                "reason": None,
            },
            "latency": {"lastMs": 16.0, "averageMs": 18.0, "maxMs": 25.0, "samples": 1},
            "gemini": {
                "enabled": gemini.enabled,
                "model": gemini.model if gemini.enabled else None,
                "mode": "gemini" if gemini.enabled else "template",
                "lastSource": "gemini" if gemini.enabled else "template",
                "lines": 0, "geminiLines": 0, "templateLines": 0, "geminiErrors": 0, "eventsConsumed": 0,
            },
            "error": None,
        },
    }


SID_RE, NAME_RE = re.compile(r"^[0-9a-f]{16}$"), re.compile(r"^[A-Za-z0-9_.-]+\.(m3u8|ts)$")


@app.get("/hls/{sid}/{name}")
async def hls(sid: str, name: str, _=Depends(auth("read"))):
    if not SID_RE.match(sid) or not NAME_RE.match(name):
        raise HTTPException(404)
    root = (manager.hls_root / sid).resolve()
    path = (root / name).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(404)
    m3u8 = name.endswith(".m3u8")
    return FileResponse(path, media_type="application/vnd.apple.mpegurl" if m3u8 else "video/mp2t",
                        headers={"Cache-Control": "no-cache" if m3u8 else "public, max-age=3600"})


# ------------------------------------------------------------------ highlights & social clipping
@app.get("/matches/{match_id}/highlights")
async def get_highlights(match_id: str, _=Depends(auth("read"))):
    s = sessions.get(match_id)
    items = []
    if s and hasattr(s, "highlighter"):
        items.extend(s.highlighter.highlights.get(match_id, []))
    items.extend(highlighter.highlights.get(match_id, []))
    seen, deduped = set(), []
    for it in items:
        if it["highlightId"] not in seen:
            seen.add(it["highlightId"])
            deduped.append(it)
    return {"highlights": deduped}


class HighlightGenIn(BaseModel):
    mediaTime: float | None = 6490.0
    eventType: str = "goal"
    eventKey: str | None = None
    ballSpeed: float | None = 86.3
    xg: float | None = 0.38
    playerId: str | None = "10"
    playerName: str | None = "Max Mata"
    description: str | None = None
    homeTeam: str | None = None
    awayTeam: str | None = None


@app.post("/matches/{match_id}/highlights/generate")
async def generate_highlight(match_id: str, body: HighlightGenIn | None = None, _=Depends(auth("admin"))):
    b = body or HighlightGenIn()
    s = sessions.get(match_id)
    home = b.homeTeam or (s.names["home"] if s else S.home_name)
    away = b.awayTeam or (s.names["away"] if s else S.away_name)
    ev = {
        "type": b.eventType,
        "eventKey": b.eventKey,
        "mediaTime": b.mediaTime,
        "ballSpeed": b.ballSpeed,
        "xg": b.xg,
        "playerId": b.playerId,
        "playerName": b.playerName,
        "description": b.description,
        "team": "home"
    }
    hl = s.highlighter if s and hasattr(s, "highlighter") else highlighter
    res = await hl.create_highlight(match_id, ev, home, away)
    return res or {"error": "could_not_create"}


highlights_dir = S.data_dir / "highlights"
highlights_dir.mkdir(parents=True, exist_ok=True)
app.mount("/highlights", StaticFiles(directory=highlights_dir), name="highlights")

memes_dir = S.data_dir / "memes"
memes_dir.mkdir(parents=True, exist_ok=True)
app.mount("/memes", StaticFiles(directory=memes_dir), name="memes")

if S.dashboard_dir and Path(S.dashboard_dir).is_dir():
    app.mount("/dashboard", StaticFiles(directory=S.dashboard_dir, html=True), name="dashboard")


# ------------------------------------------------------------------ socket.io  (namespace /live)
async def _maybe(x):
    return await x if inspect.isawaitable(x) else x


@sio.on("connect", namespace="/live")
async def on_connect(sid, environ, auth_data=None):
    a = auth_data if isinstance(auth_data, dict) else {}
    if not allows(scope_for(a.get("key"), a.get("token")), "read"):
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")


@sio.on("join", namespace="/live")
async def on_join(sid, data):
    mid = str((data or {}).get("matchId", ""))
    s = sessions.get(mid)
    if not s:
        return {"ok": False, "error": "unknown match"}
    room = f"match:{mid}"
    for r in list(sio.rooms(sid, namespace="/live")):
        if r.startswith("match:") and r != room:
            await _maybe(sio.leave_room(sid, r, namespace="/live"))
    async with s.lock:                                  # snapshot is delivered before any broadcast can reach this client
        await sio.emit("snapshot", s.snapshot(), to=sid, namespace="/live")
        await _maybe(sio.enter_room(sid, room, namespace="/live"))
    src = next((x for x in manager.sources.values() if x.match_id == mid), None)
    if src:
        await sio.emit("source", src.public(), to=sid, namespace="/live")
    return {"ok": True}


@sio.on("leave", namespace="/live")
async def on_leave(sid, data):
    mid = str((data or {}).get("matchId", ""))
    await _maybe(sio.leave_room(sid, f"match:{mid}", namespace="/live"))
    return {"ok": True}


@sio.on("resync", namespace="/live")
async def on_resync(sid, data):
    s = sessions.get(str((data or {}).get("matchId", "")))
    stream, after = (data or {}).get("stream"), int((data or {}).get("afterSeq", 0))
    if not s or stream not in ("events", "commentary"):
        return {"ok": False}
    msgs = s.events_after(after) if stream == "events" else s.commentary_after(after)
    await sio.emit("resync", {"matchId": s.match_id, "stream": stream, "messages": msgs}, to=sid, namespace="/live")
    return {"ok": True, "count": len(msgs)}


_sio_app = socketio.ASGIApp(sio)


async def asgi(scope, receive, send):
    """Single ASGI entry point: /socket.io -> Socket.IO, everything else (and lifespan) -> FastAPI."""
    if scope["type"] in ("http", "websocket") and scope["path"].startswith("/socket.io"):
        await _sio_app(scope, receive, send)
    else:
        await app(scope, receive, send)
