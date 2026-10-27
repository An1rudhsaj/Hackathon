"""MatchSession: the single consumer of tracking frames (simulator OR video). For each frame it computes speeds, runs the
event engine, keeps score/stats, builds contract messages, stores them and broadcasts them.
No FastAPI / Socket.IO imports here: `emit(match_id, stream, payload)` is injected, so this runs (and is tested) alone."""
from __future__ import annotations
import asyncio
import gzip
import json
import time
from collections import deque
from pathlib import Path

from .analytics import (FormationVoter, Kinematics, PlayerMetrics, detect_formation, pitch_control_grid,
                        win_probability, xt_value)
from .events import EventEngine
from .highlighter import Highlighter
from .models import validate

NOTABLE = {"goal", "save", "shot", "corner", "tackle", "goal_kick", "throw_in"}


class TrackingWriter:
    """Appends frames as gzip JSON-lines (concatenated gzip members are valid)."""
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path, self.buf = path, []

    def add(self, d): self.buf.append(json.dumps(d, separators=(",", ":")))

    def flush(self):
        if self.buf:
            data = ("\n".join(self.buf) + "\n").encode()
            self.buf = []
            with gzip.open(self.path, "ab") as f:
                f.write(data)


def read_tracking(path: Path, t0: float = 0.0, t1: float = 1e18):
    if not path.exists():
        return
    with gzip.open(path, "rt") as f:
        for line in f:
            if not line.strip():
                continue
            d = json.loads(line)
            if t0 <= d.get("mediaTime", 0) <= t1:
                yield d


class MatchSession:
    def __init__(self, match_id, emit, *, home, away, mode="live", clock_scale=1.0, gemini=None, db=None,
                 data_dir=Path("./data"), results_fps=10.0, comment_interval=8.0, max_tracking_hz=25.0):
        self.match_id, self.emit, self.mode = match_id, emit, mode
        self.names = {"home": home, "away": away}
        self.clock_scale, self.gemini, self.db = clock_scale, gemini, db
        self.highlighter = Highlighter(data_dir=data_dir, gemini=gemini)
        self.live = mode == "live"                      # live: broadcast tracking; batch: store for replay by mediaTime
        self.lock = asyncio.Lock()
        self.seq = {"tracking": 0, "events": 0, "analytics": 0, "commentary": 0}
        self.latest = {"tracking": None, "analytics": None}
        self.events_log = deque(maxlen=5000)            # (seq, msg)
        self.commentary_log = deque(maxlen=500)
        self.events_latest = {}
        self.engine, self.kin, self.pm = EventEngine(), Kinematics(), PlayerMetrics()
        self.voters = {"home": FormationVoter(), "away": FormationVoter()}
        self.formation = {"home": "unknown", "away": "unknown"}
        self.score = {"home": 0, "away": 0}
        self.shots = {"home": 0, "away": 0}; self.passes = {"home": 0, "away": 0}
        self.xg = {"home": 0.0, "away": 0.0}; self.xt = {"home": 0.0, "away": 0.0}
        self.counted = {"goal": set(), "shot": set(), "pass": set()}
        self.fastest = None
        self.poss_frames = {"home": 0, "away": 0}; self.last_poss = None
        self.pc_share = {"home": 0.5, "away": 0.5}; self.pc_grid = None
        self.frame_no = 0; self.segment = 0; self.last_t = None; self.last_an = -99.0; self.next_res = 0.0
        self.res_dt = 1.0 / results_fps
        self.results = {"tracking": [], "events": [], "analytics": [], "commentary": [], "moments": [], "summary": None}
        self.num_by_id = {}
        self.writer = TrackingWriter(data_dir / "tracking" / f"{match_id}.jsonl.gz")
        self._last_flush = time.monotonic()
        self._tr_busy = False; self._tr_min_dt = 1.0 / max_tracking_hz; self._tr_last = 0.0
        self._cq = []; self._last_comm_t = -99.0; self._comm_interval = comment_interval; self._tasks = set()
        self.closed = False
        self.error = None

    # ----------------------------------------------------------------- stamping / sending
    def _stamp(self, stream, kind, body):
        self.seq[stream] += 1
        msg = {"schemaVersion": 1, "matchId": self.match_id, "seq": self.seq[stream], "ts": int(time.time() * 1000), **body}
        return validate(kind, msg)

    async def _send(self, stream, msg):
        async with self.lock:                           # join() takes the same lock -> snapshot always precedes broadcasts
            await self.emit(self.match_id, stream, msg)

    def _spawn(self, coro):
        t = asyncio.create_task(coro); self._tasks.add(t); t.add_done_callback(self._tasks.discard)

    # ----------------------------------------------------------------- main entry
    async def push(self, fr: dict):
        if self.closed:
            return
        t = fr["t"]
        if fr.get("segment", 0) != self.segment:        # RTSP reconnect: timeline discontinuity
            self.segment = fr.get("segment", 0); self.kin.reset(); self.engine.reset_ball_state()
        dt = (t - self.last_t) if self.last_t is not None and t > self.last_t else 1 / 25
        self.last_t = t
        cs = t * self.clock_scale
        clock = {"period": 1 if cs < 2700 else 2, "seconds": round(cs, 2)}
        players = [dict(p) for p in fr["players"]]
        steps = self.kin.players(players, t)
        for p in players:
            self.num_by_id[p["id"]] = p["num"]
            self.pm.update(p["id"], steps.get(p["id"], 0.0), p["speed"], dt)
        ball = dict(fr["ball"]) if fr.get("ball") else None
        if ball:
            ball["speed"] = self.kin.ball(ball, t)
            ball["airborne"] = ball["z"] > 0.3
        else:
            self.kin.ball_lost()
        evs = self.engine.update({"t": t, "clock": clock, "players": players, "ball": ball})
        holder = self.engine.holder
        poss = holder["team"] if holder else self.last_poss
        if poss:
            self.last_poss = poss; self.poss_frames[poss] += 1
        self.frame_no += 1
        tmsg = self._stamp("tracking", "tracking", {
            "frame": self.frame_no, "mediaTime": round(t, 3), "mediaSegment": self.segment, "clock": clock,
            "players": [{k: p[k] for k in ("id", "team", "num", "role", "x", "y", "speed", "conf")} for p in players],
            "ball": None if ball is None else {k: ball[k] for k in ("x", "y", "z", "speed", "airborne", "conf")},
            "possession": holder["team"] if holder else None, "holderId": holder["id"] if holder else None})
        self.latest["tracking"] = tmsg
        self.writer.add(tmsg)
        if self.live:
            now = time.monotonic()
            if not self._tr_busy and now - self._tr_last >= self._tr_min_dt * 0.9:
                self._tr_last = now; self._tr_busy = True
                self._spawn(self._send_tracking(tmsg))
        elif t + 1e-9 >= self.next_res:                 # batch: keep a downsampled copy for GET /sources/{id}/results
            self.next_res = max(self.next_res + self.res_dt, t); self.results["tracking"].append(tmsg)
        for ev in evs:
            await self._on_event(ev)
        if t - self.last_an >= 2.0:
            self.last_an = t
            await self._analytics(t, players, clock)
        if self._cq and t - self._last_comm_t >= self._comm_interval:
            self._last_comm_t = t
            batch, self._cq = self._cq[-5:], []
            self._spawn(self._commentary(batch, t, clock))
        if time.monotonic() - self._last_flush > 5:
            self._last_flush = time.monotonic()
            await asyncio.to_thread(self.writer.flush)

    async def _send_tracking(self, msg):
        try:
            await self._send("tracking", msg)
        finally:
            self._tr_busy = False

    # ----------------------------------------------------------------- events
    async def _on_event(self, ev):
        msg = self._stamp("events", "events", ev)
        self.events_log.append((msg["seq"], msg)); self.events_latest[msg["eventId"]] = msg
        eid, typ, st = msg["eventId"], msg["type"], msg["status"]
        if typ == "goal":
            if st == "confirmed" and eid not in self.counted["goal"]:
                self.counted["goal"].add(eid); self.score[msg["team"]] += 1
                try:
                    asyncio.create_task(self.highlighter.create_highlight(
                        self.match_id, msg, self.names["home"], self.names["away"]
                    ))
                except Exception:
                    pass
            elif st == "retracted" and eid in self.counted["goal"]:
                self.counted["goal"].discard(eid); self.score[msg["team"]] -= 1
        elif typ == "shot" and st == "confirmed" and eid not in self.counted["shot"]:
            self.counted["shot"].add(eid); self.shots[msg["team"]] += 1; self.xg[msg["team"]] += msg.get("xg") or 0.0
        elif typ == "pass" and st == "confirmed" and eid not in self.counted["pass"]:
            self.counted["pass"].add(eid); self.passes[msg["team"]] += 1
            if msg.get("end"):
                self.xt[msg["team"]] += max(0.0, xt_value(msg["end"]["x"], msg["end"]["y"], msg["team"]) -
                                            xt_value(msg["start"]["x"], msg["start"]["y"], msg["team"]))
        if typ == "shot" and msg.get("ballSpeed") and st != "retracted":
            if self.fastest is None or msg["ballSpeed"] > self.fastest["speed"]:
                self.fastest = {"playerId": msg["playerId"], "speed": msg["ballSpeed"]}
        if typ in NOTABLE and st == "confirmed" and msg["revision"] <= 3:
            self._cq.append(msg)
        if self.db:
            try:
                self.db.save_event(self.match_id, msg)
            except Exception:
                pass
        if self.live:
            await self._send("events", msg)
        else:
            self.results["events"].append(msg)

    # ----------------------------------------------------------------- analytics
    async def _analytics(self, t, players, clock):
        grid = pitch_control_grid(players)
        self.pc_grid = grid
        h = float(grid.mean()); self.pc_share = {"home": round(h, 4), "away": round(1 - h, 4)}
        for tm in ("home", "away"):
            self.formation[tm] = self.voters[tm].update(detect_formation(players, tm))
        tot = max(1, sum(self.poss_frames.values()))
        ph = round(self.poss_frames["home"] / tot * 100, 1)
        pr = lambda d: {"home": round(d["home"], 3), "away": round(d["away"], 3)}
        msg = self._stamp("analytics", "analytics", {
            "mediaTime": round(t, 3), "score": dict(self.score), "possessionPct": {"home": ph, "away": round(100 - ph, 1)},
            "xg": pr(self.xg), "xt": pr(self.xt), "shots": dict(self.shots), "passes": dict(self.passes),
            "winProbability": win_probability(self.score["home"], self.score["away"], self.xg["home"], self.xg["away"], clock["seconds"]),
            "formation": dict(self.formation), "pitchControl": dict(self.pc_share),
            "pitchControlGrid": [[round(float(v), 3) for v in row] for row in grid],
            "fastestShot": self.fastest, "playerMetrics": self.pm.snapshot(), "eventsThroughSeq": self.seq["events"]})
        self.latest["analytics"] = msg
        if self.live:
            await self._send("analytics", msg)
        else:
            self.results["analytics"].append(msg)

    # ----------------------------------------------------------------- commentary (async, throttled, never blocks the frame loop)
    def _template(self, ev):
        n = self.num_by_id.get(ev.get("playerId"), "")
        who = f"#{n} " if n != "" else ""
        team = self.names[ev["team"]]
        return {"goal": f"GOAL! {who}scores for {team}.", "save": f"Good save from {who}of {team}.",
                "shot": f"{who}of {team} takes a shot.", "corner": f"Corner to {team}.",
                "tackle": f"{who}of {team} wins the ball.", "goal_kick": f"Goal kick for {team}.",
                "throw_in": f"Throw-in to {team}."}.get(ev["type"], f"{ev['type']} for {team}.")

    def _template_personas(self, batch):
        e = batch[-1]
        n = self.num_by_id.get(e.get("playerId"), "")
        who = f"#{n} " if n != "" else ""
        team = self.names[e["team"]]
        spd = f" with {round(e.get('ballSpeed', 0))} km/h strike" if e.get("ballSpeed") else ""

        tactical = {
            "goal": f"Tactical: {who}of {team} breaks the defensive block{spd} to score.",
            "shot": f"Tactical: High xG attempt generated by {who}for {team}{spd}.",
            "save": f"Tactical: Defensive goalkeeper positioning denies {team} a high-probability chance.",
            "pass": f"Tactical: {team} progressing efficiently through central passing lanes.",
            "tackle": f"Tactical: Counter-press turnover triggered as {who}wins the ball for {team}."
        }.get(e["type"], f"Tactical: {team} maintains compact shape during {e['type']}.")

        hype = {
            "goal": f"GOOOOOAL! 🔥 {who}finds the back of the net for {team}! ABSOLUTE SCENES! 🚀",
            "shot": f"WHAT A HIT! 🎯 {who}lets fly for {team}{spd}! That was inches away!",
            "save": f"INCREDIBLE STOP! 🧤 Massive reaction save keeps {team} in the contest!",
            "pass": f"Pure class! 🪄 Crisp midfield linkup play from {team}!",
            "tackle": f"MONSTER TACKLE! 💥 {who}steps up with authority for {team}!"
        }.get(e["type"], f"Action underway! {who}involved for {team}! ⚡")

        radio = {
            "goal": f"Goal scored. {who}of {team} puts the ball cleanly over the goal line.",
            "shot": f"Shot on target. {who}strikes toward the mouth of the goal for {team}.",
            "save": f"Save made. The goalkeeper collects securely inside the box for {team}.",
            "pass": f"Pass completed in the middle third by {team}.",
            "tackle": f"Challenge made as {who}wins the ball firmly for {team}."
        }.get(e["type"], f"Play resumes with a {e['type']} for {team}.")

        return {"tactical": tactical, "hype": hype, "radio": radio}

    async def _commentary(self, batch, t, clock):
        ctx = {"clock_minute": int(clock["seconds"] // 60), "score": f"{self.names['home']} {self.score['home']}-{self.score['away']} {self.names['away']}",
               "events": [{"type": e["type"], "team": self.names[e["team"]], "player_number": self.num_by_id.get(e.get("playerId")),
                           "ball_speed_kmh": e.get("ballSpeed"), "outcome": e.get("outcome")} for e in batch]}
        res = await self.gemini.commentary(ctx) if self.gemini else None
        if isinstance(res, dict) and "tactical" in res:
            personas = res
            src = "gemini"
        elif isinstance(res, str) and res:
            personas = {"tactical": res, "hype": res, "radio": res}
            src = "gemini"
        else:
            personas = self._template_personas(batch)
            src = "template"
        text = personas.get("tactical") or " ".join(self._template(e) for e in batch[-2:])
        msg = self._stamp("commentary", "commentary", {
            "mediaTime": round(t, 3), "text": text, "personas": personas, "eventId": batch[-1]["eventId"], "source": src
        })
        self.commentary_log.append(msg)
        if self.live:
            await self._send("commentary", msg)
        else:
            self.results["commentary"].append(msg)

    # ----------------------------------------------------------------- snapshot / resync / results
    def snapshot(self):
        evs = sorted(self.events_latest.values(), key=lambda m: m["seq"])[-50:]
        return {"matchId": self.match_id, "seq": {k: self.seq[k] for k in ("tracking", "events", "analytics")},
                "tracking": self.latest["tracking"], "analytics": self.latest["analytics"], "events": evs,
                "commentary": self.commentary_log[-1] if self.commentary_log else None, "mode": self.mode}

    def events_after(self, seq): return [m for s, m in self.events_log if s > seq]
    def commentary_after(self, seq): return [m for m in self.commentary_log if m["seq"] > seq]

    def get_results(self, t0, t1):
        inr = lambda m: t0 <= (m.get("mediaTime") or 0) <= t1
        r = self.results
        return {"tracking": [m for m in r["tracking"] if inr(m)], "events": [m for m in r["events"] if inr(m)],
                "analytics": [m for m in r["analytics"] if inr(m)], "commentary": [m for m in r["commentary"] if inr(m)],
                "moments": r["moments"], "summary": r["summary"]}

    # ----------------------------------------------------------------- lifecycle
    async def finalize(self):
        """Flush everything at EOF / failure / stop / shutdown. Safe to call more than once."""
        if self.closed:
            return
        # let in-flight commentary tasks finish, then stop accepting frames
        if self._tasks:
            await asyncio.wait(list(self._tasks), timeout=15)
        if self.last_t is not None and self.latest["tracking"] is not None:
            pl = [{k: p[k] for k in ("id", "team", "role", "x", "y")} for p in self.latest["tracking"]["players"]]
            clock = self.latest["tracking"]["clock"]
            await self._analytics(self.last_t, pl, clock)
        self.closed = True
        try:
            await asyncio.to_thread(self.writer.flush)
            if self.db:
                self.db.save_metrics(self.match_id, self.pm.snapshot())
        except Exception as e:
            self.error = str(e)
