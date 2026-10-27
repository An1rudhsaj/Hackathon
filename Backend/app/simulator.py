"""Deterministic match simulator (4-3-3 vs 4-3-3). Produces the same Frame dicts the vision pipeline produces:
{t, segment, players[{id,team,num,role,x,y,conf}], ball{x,y,z,conf}}. Events are NOT emitted here: the event engine
detects them from positions exactly as it does for real video."""
from __future__ import annotations
import math
import random
from .analytics import xg_model
from .geometry import HL, HW, attack_dir, other

FM = [(-48, 0), (-34, -22), (-36, -8), (-36, 8), (-34, 22), (-18, -14), (-20, 0), (-18, 14), (-4, -22), (-2, 0), (-4, 22)]
NUM = [1, 2, 4, 5, 3, 8, 6, 10, 7, 9, 11]
ROLES = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"]


class Simulator:
    def __init__(self, seed: int = 7, fps: float = 25.0):
        self.rng = random.Random(seed)
        self.dt = 1.0 / fps
        self.t = 0.0
        self.players = []
        for team in ("home", "away"):
            d = attack_dir(team)
            for i, (fx, fy) in enumerate(FM):
                self.players.append({"id": ("H" if team == "home" else "A") + str(i + 1), "team": team, "num": NUM[i],
                                     "role": ROLES[i], "i": i, "bx": fx * d, "by": fy * d, "x": float(fx * d),
                                     "y": float(fy * d), "ph": self.rng.uniform(0, 6.28)})
        self.ball = {"x": 0.0, "y": 0.0, "z": 0.3}
        self.mode = "hold"
        self.holder = self.players[9]
        self.timer = 1.5
        self.fl = None
        self.dead = 0.0
        self.after = None
        self.gk_target = None

    # ---------------------------------------------------------------- helpers
    def _team(self, team): return [p for p in self.players if p["team"] == team]

    def _start_flight(self, kind, to_fn, speed, arc, target_player=None, shot=None):
        a = self.ball
        self.fl = {"kind": kind, "fx": a["x"], "fy": a["y"], "to": to_fn, "dur": 1.0, "t": 0.0, "arc": arc,
                   "tp": target_player, "shot": shot, "speed": speed}
        tx, ty = to_fn()
        self.fl["dur"] = max(0.2, math.hypot(tx - a["x"], ty - a["y"]) / speed)
        self.mode = "flight"

    def _decide(self):
        p = self.holder
        d = attack_dir(p["team"])
        gx = d * HL
        away = abs(gx - p["x"])
        rng = self.rng
        if away < 32 and rng.random() < 0.4:
            xg = xg_model(p["x"], p["y"], p["team"])
            r = rng.random()
            out = "goal" if r < xg * 1.5 + 0.12 else "save" if r < 0.7 else "miss"
            ty = rng.uniform(-3, 3) if out == "goal" else rng.uniform(-2.5, 2.5) if out == "save" else rng.choice([-1, 1]) * rng.uniform(5, 9)
            tx = gx + d * 1.5 if out != "save" else gx - d * 0.8
            self.gk_target = (tx, ty) if out == "save" else None
            self._start_flight("shot", lambda: (tx, ty), rng.uniform(24, 34), 1.0, shot=out)
            self.fl["shooter"] = p
            return
        opp = other(p["team"])
        if rng.random() < 0.10:                                   # tackle: opponent wins the ball over a short flight
            o = min((q for q in self._team(opp) if q["role"] != "GK"), key=lambda q: math.hypot(q["x"] - p["x"], q["y"] - p["y"]))
            if math.hypot(o["x"] - p["x"], o["y"] - p["y"]) < 7:
                self._start_flight("pass", lambda o=o: (o["x"], o["y"]), 7.0, 0.2, target_player=o)
                return
        mates = [q for q in self._team(p["team"]) if q is not p]
        best = max(mates, key=lambda q: (q["x"] - p["x"]) * d * 1.0 + rng.uniform(0, 12) - math.hypot(q["x"] - p["x"], q["y"] - p["y"]) * 0.1)
        if rng.random() < 0.06:                                   # intercepted pass
            best = min(self._team(opp), key=lambda q: math.hypot(q["x"] - best["x"], q["y"] - best["y"]))
        dist = math.hypot(best["x"] - p["x"], best["y"] - p["y"])
        self._start_flight("pass", lambda b=best: (b["x"], b["y"]), rng.uniform(9, 17), min(dist * 0.2, 9) if dist > 28 else 0.4, target_player=best)

    # ---------------------------------------------------------------- step
    def step(self) -> dict:
        dt = self.dt
        self.t += dt
        bt = self.holder["team"] if self.holder else "home"
        # players
        for p in self.players:
            d = attack_dir(p["team"])
            gk = p["role"] == "GK"
            att = 1 if bt == p["team"] else -0.4
            tx = p["bx"] + self.ball["x"] * (0.08 if gk else 0.62) + d * att * (0 if gk else 14) + math.sin(self.t * 0.9 + p["ph"]) * 2.5
            ty = p["by"] + self.ball["y"] * (0.2 if gk else 0.25) + math.cos(self.t * 1.1 + p["ph"]) * 2.5
            if p is self.holder and self.mode == "hold":
                tx, ty = p["x"] + d * 2, p["y"] + math.sin(self.t * 2.5) * 2
            if gk and self.gk_target and self.mode == "flight" and p["team"] != (self.fl["shooter"]["team"] if self.fl and "shooter" in self.fl else ""):
                pass
            if gk and self.gk_target and self.fl and self.fl.get("shooter") and p["team"] != self.fl["shooter"]["team"]:
                tx, ty = self.gk_target
            k = 1 - math.exp(-dt * (2.2 if (gk and self.gk_target) else 1.2))
            mx, my = (tx - p["x"]) * k, (ty - p["y"]) * k
            cap = (9.0 if (gk and self.gk_target) else 6.5) * dt
            m = math.hypot(mx, my)
            if m > cap:
                mx, my = mx * cap / m, my * cap / m
            p["x"] = max(-HL, min(HL, p["x"] + mx)); p["y"] = max(-HW, min(HW, p["y"] + my))
        # ball
        b = self.ball
        if self.mode == "hold":
            d = attack_dir(self.holder["team"])
            b["x"], b["y"], b["z"] = self.holder["x"] + d * 0.9, self.holder["y"], 0.3
            self.timer -= dt
            if self.timer <= 0:
                self._decide()
        elif self.mode == "flight":
            f = self.fl
            f["t"] += dt / f["dur"]
            u = min(f["t"], 1.0)
            te = u if f["kind"] == "shot" else u * (1.5 - 0.5 * u)          # passes decelerate into the receiver
            tx, ty = f["to"]()
            b["x"] = f["fx"] + (tx - f["fx"]) * te
            b["y"] = f["fy"] + (ty - f["fy"]) * te
            b["z"] = 0.3 + f["arc"] * 4 * u * (1 - u) if f["kind"] == "pass" else 0.3 + 1.2 * 4 * u * (1 - u)
            if f["t"] >= 1.0:
                self._land()
        else:                                                          # dead ball (goal / miss) for a moment
            self.dead -= dt
            if self.dead <= 0:
                self._restart()
        return self.frame()

    def _land(self):
        f, self.fl = self.fl, None
        self.gk_target = None
        if f["kind"] == "pass":
            self.holder = f["tp"]; self.mode = "hold"; self.timer = self.rng.uniform(0.5, 1.3)
            return
        shooter = f["shooter"]; opp = other(shooter["team"])
        gk = next(p for p in self._team(opp) if p["role"] == "GK")
        if f["shot"] == "save":
            self.holder = gk; self.mode = "hold"; self.timer = self.rng.uniform(1.0, 1.8)
        else:
            self.mode = "dead"; self.dead = 0.8
            self.after = ("kickoff", opp) if f["shot"] == "goal" else ("goal_kick", opp)
            self.ball["z"] = 0.3

    def _restart(self):
        kind, team = self.after
        pl = self._team(team)
        if kind == "kickoff":
            self.holder = min((p for p in pl if p["role"] != "GK"), key=lambda p: math.hypot(p["x"], p["y"]))
        else:
            self.holder = next(p for p in pl if p["role"] == "GK")
        self.mode = "hold"; self.timer = self.rng.uniform(1.0, 1.8)

    def frame(self) -> dict:
        return {"t": round(self.t, 4), "segment": 0,
                "players": [{"id": p["id"], "team": p["team"], "num": p["num"], "role": p["role"],
                             "x": round(p["x"], 3), "y": round(p["y"], 3), "conf": 0.95} for p in self.players],
                "ball": {"x": round(self.ball["x"], 3), "y": round(self.ball["y"], 3), "z": round(self.ball["z"], 3), "conf": 0.95}}
