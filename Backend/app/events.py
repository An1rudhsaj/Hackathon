"""Event engine: turns tracking frames into events using geometry rules.
Input per frame: {t (media seconds), clock, players[{id,team,role,x,y,...}], ball {x,y,z,speed(km/h),conf} | None}
Output: list of full event dicts (every returned dict is a new revision of an eventId).
Lifecycle: provisional (rev 1) -> confirmed (after CONFIRM_DELAY) or retracted. A goal is confirmed only after the
ball has been past the line (between the posts, under the bar) for GOAL_FRAMES consecutive frames."""
from __future__ import annotations
import math
from .analytics import xg_model
from .geometry import HL, HW, GOAL_HALF, GOAL_H, attack_dir, other, in_box, dist

POSS_R, POSS_Z, POSS_N = 2.0, 2.6, 3          # nearest player within 2 m, ball under 2.6 m, for 3 frames
FAST_MS, GK_CATCH_R = 12.0, 1.0               # ball faster than 12 m/s can't be controlled (except GK catch within 1 m)
SHOT_MS = 16.0                                # release speed that makes a shot candidate
CONFIRM_DELAY = 1.0
GOAL_FRAMES = 3
MISSING_RESET = 25
OUT_FRAMES = 5
SHOT_TIMEOUT = 4.0


def _r(v, n=2): return None if v is None else round(float(v), n)


class EventEngine:
    def __init__(self):
        self.n = 0
        self.events: dict[str, dict] = {}
        self.pending: dict[str, float] = {}
        self.clock = {"period": 1, "seconds": 0.0}
        self.t = 0.0
        self.last_touch = None
        self.reset_ball_state()

    def reset_ball_state(self):
        self.holder = None; self.cand = (None, 0); self.flight = None; self.shot = None; self.goal = None
        self.prev = []; self.missing = 0; self.out_n = 0; self.in_n = 0; self.out_fired = False

    # ------------------------------------------------------------------ helpers
    def _new(self, type_, team, pid, start, out, end=None, target=None, conf=0.9, confirm=True, **kw):
        self.n += 1
        eid = f"e{self.n:05d}"
        ev = {"eventId": eid, "revision": 1, "status": "provisional", "type": type_, "clock": dict(self.clock),
              "mediaTime": round(self.t, 3), "team": team, "playerId": pid, "targetPlayerId": target,
              "start": {"x": _r(start[0]), "y": _r(start[1])},
              "end": None if end is None else {"x": _r(end[0]), "y": _r(end[1])},
              "ballSpeed": None, "distance": None, "xg": None, "outcome": None, "intoBox": None, "conf": conf}
        ev.update(kw)
        self.events[eid] = ev
        if confirm:
            self.pending[eid] = self.t + CONFIRM_DELAY
        out.append(dict(ev))
        return eid

    def _update(self, eid, out, **fields):
        ev = self.events[eid]
        ev.update(fields); ev["revision"] += 1
        out.append(dict(ev))

    def _due(self, out):
        for eid, due in list(self.pending.items()):
            if self.t >= due:
                self.pending.pop(eid)
                if self.events[eid]["status"] == "provisional":
                    self._update(eid, out, status="confirmed")

    @staticmethod
    def _nearest(players, b):
        best, bd = None, 1e9
        for p in players:
            d = math.hypot(p["x"] - b["x"], p["y"] - b["y"])
            if d < bd:
                best, bd = p, d
        return best, bd

    def _vel(self):
        if len(self.prev) < 3:
            return 0.0, 0.0
        a, c = self.prev[-3], self.prev[-1]
        dt = c[0] - a[0]
        return ((c[1] - a[1]) / dt, (c[2] - a[2]) / dt) if dt > 0 else (0.0, 0.0)

    # ------------------------------------------------------------------ main step
    def update(self, fr):
        out = []
        self.t = fr["t"]; self.clock = fr["clock"]
        self._due(out)
        b = fr.get("ball")
        if b is None or b.get("conf", 1.0) < 0.15:                 # ball not observed: never crash, never invent
            self.missing += 1
            if self.missing > MISSING_RESET:
                self.reset_ball_state()
            return out
        self.missing = 0
        self.prev.append((self.t, b["x"], b["y"], b["z"]))
        self.prev = self.prev[-6:]
        pl = fr["players"]
        if self.holder:
            for p in pl:
                if p["id"] == self.holder["id"]:
                    self.holder["pos"] = (p["x"], p["y"])
        near, nd = self._nearest(pl, b)
        if near is not None and nd <= 1.3:
            self.last_touch = {"team": near["team"], "id": near["id"]}
        spd = b.get("speed", 0.0) / 3.6
        ok = (near is not None and b["z"] <= POSS_Z and
              ((nd <= POSS_R and spd <= FAST_MS) or (nd <= GK_CATCH_R and near["role"] == "GK")))
        gained = None
        if ok:
            self.cand = (near["id"], self.cand[1] + 1) if self.cand[0] == near["id"] else (near["id"], 1)
            if self.cand[1] >= POSS_N and (self.holder is None or self.holder["id"] != near["id"]):
                gained = near
        else:
            self.cand = (None, 0)
        if self.holder and gained is None and dist((b["x"], b["y"]), self.holder["pos"]) > 2.8:
            self._release(b, out)
        if gained is not None:
            self._gain(gained, b, out)
        if self.flight:
            self.flight["max"] = max(self.flight["max"], b.get("speed", 0.0))
        if self.shot:
            self.shot["max"] = max(self.shot["max"], b.get("speed", 0.0))
        self._shot_step(b, out)
        self._out_step(b, out)
        return out

    # ------------------------------------------------------------------ possession
    def _release(self, b, out):
        h = self.holder
        self.flight = {"id": h["id"], "team": h["team"], "start": h["pos"], "t0": self.t, "max": b.get("speed", 0.0)}
        v = self._vel()
        speed = math.hypot(*v)
        d = attack_dir(h["team"])
        if self.shot is None and speed >= SHOT_MS and v[0] * d > 2:
            tt = (d * HL - b["x"]) / v[0]
            y_int = b["y"] + v[1] * tt
            gdist = math.hypot(d * HL - h["pos"][0], h["pos"][1])
            if abs(y_int) <= GOAL_HALF + 6 and gdist <= 35:
                xg = xg_model(h["pos"][0], h["pos"][1], h["team"])
                eid = self._new("shot", h["team"], h["id"], h["pos"], out, xg=xg, conf=0.85)
                self.shot = {"eid": eid, "team": h["team"], "pid": h["id"], "t0": self.t, "max": b.get("speed", 0.0)}
        self.holder = None

    def _gain(self, p, b, out):
        fl, self.flight = self.flight, None
        self.holder = {"id": p["id"], "team": p["team"], "role": p["role"], "pos": (p["x"], p["y"])}
        if self.shot is not None:
            self._shot_possession(p, b, out)
            return
        if fl and fl["id"] != p["id"] and self.t - fl["t0"] <= 8:
            end = (p["x"], p["y"])
            if fl["team"] == p["team"]:
                d = dist(fl["start"], end)
                self._new("pass", p["team"], fl["id"], fl["start"], out, end=end, target=p["id"],
                          distance=_r(d), ballSpeed=_r(fl["max"], 1) if d > 30 else None,
                          intoBox=in_box(end[0], end[1], p["team"]), outcome="complete", conf=0.9)
            else:
                self._new("tackle", p["team"], p["id"], end, out, target=fl["id"], conf=0.8)

    # ------------------------------------------------------------------ shots / goals / saves
    def _resolve_shot(self, outcome, out):
        s = self.shot
        self._update(s["eid"], out, outcome=outcome, ballSpeed=_r(s["max"], 1))
        self.shot = None

    def _shot_possession(self, p, b, out):
        s = self.shot
        if self.goal is not None:
            return
        if p["team"] != s["team"] and p["role"] == "GK":
            self._new("save", p["team"], p["id"], (b["x"], b["y"]), out, outcome="saved", target=s["pid"], conf=0.85)
            self._resolve_shot("saved", out)
        else:
            self._resolve_shot("blocked", out)

    def _shot_step(self, b, out):
        s = self.shot
        if not s:
            return
        d = attack_dir(s["team"])
        if b["x"] * d > HL:
            if abs(b["y"]) < GOAL_HALF and b["z"] < GOAL_H:
                if self.goal is None:
                    sev = self.events[s["eid"]]
                    gid = self._new("goal", s["team"], s["pid"], (sev["start"]["x"], sev["start"]["y"]), out,
                                    end=(b["x"], b["y"]), xg=sev["xg"], confirm=False, conf=0.9)
                    self.goal = {"eid": gid, "n": 0}
                self.goal["n"] += 1
                if self.goal["n"] >= GOAL_FRAMES:
                    self._update(self.goal["eid"], out, status="confirmed", ballSpeed=_r(s["max"], 1), outcome="goal")
                    self._resolve_shot("goal", out)
                    self.goal = None; self.flight = None
            elif self.goal is None:
                self._resolve_shot("off_target", out)
        elif self.goal is not None:                                    # came back before 3 frames: not a goal
            self._update(self.goal["eid"], out, status="retracted")
            self.goal = None
        if self.shot and self.t - s["t0"] > SHOT_TIMEOUT:
            if self.goal is not None:
                self._update(self.goal["eid"], out, status="retracted"); self.goal = None
            self._resolve_shot("off_target", out)

    # ------------------------------------------------------------------ restarts
    def _out_step(self, b, out):
        inside = abs(b["x"]) <= HL and abs(b["y"]) <= HW
        if inside:
            self.in_n += 1; self.out_n = 0
            if self.in_n >= 10:
                self.out_fired = False
            return
        if abs(b["x"]) > HL and abs(b["y"]) <= GOAL_HALF + 0.5:      # inside the goal mouth: handled as goal/shot
            return
        self.in_n = 0; self.out_n += 1
        if self.out_n < OUT_FRAMES or self.out_fired or not self.last_touch:
            return
        self.out_fired = True
        lt = self.last_touch
        x, y = max(-HL, min(HL, b["x"])), max(-HW, min(HW, b["y"]))
        if abs(b["y"]) > HW:
            self._new("throw_in", other(lt["team"]), None, (x, y), out, conf=0.8)
        else:
            defender = "away" if b["x"] > 0 else "home"
            if lt["team"] == defender:
                self._new("corner", other(defender), None, (x, y), out, conf=0.8)
            else:
                self._new("goal_kick", defender, None, (x, y), out, conf=0.8)
        self.reset_ball_state_keep_out()

    def reset_ball_state_keep_out(self):
        self.holder = None; self.flight = None; self.cand = (None, 0)
