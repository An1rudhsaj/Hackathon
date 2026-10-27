"""Deterministic analytics: xG, xT, pitch control, formation, win probability, kinematics, player metrics."""
from __future__ import annotations
import math
from collections import Counter, deque
import numpy as np
from .geometry import HL, HW, GOAL_HALF, attack_dir, clamp


def xg_model(x: float, y: float, team: str) -> float:
    """Logistic xG from distance and the angle the goal subtends."""
    dx = abs(attack_dir(team) * HL - x)
    d = math.hypot(dx, y)
    a = math.atan2(2 * GOAL_HALF * dx, dx * dx + y * y - GOAL_HALF ** 2)
    if a < 0:
        a += math.pi
    return round(1 / (1 + math.exp(-(-1.0 - 0.12 * d + 1.5 * a))), 3)


def _build_xt(nx=16, ny=12):
    xs = (np.arange(nx) + .5) / nx * 105 - HL
    ys = (np.arange(ny) + .5) / ny * 68 - HW
    X, Y = np.meshgrid(xs, ys)
    return 0.0035 + 0.30 * np.exp(-np.hypot(HL - X, Y) / 9.0)      # [12][16], attacking toward +x


XT = _build_xt()


def xt_value(x: float, y: float, team: str) -> float:
    xx = x * attack_dir(team)
    return float(XT[int(clamp((y + HW) / 68 * 12, 0, 11)), int(clamp((xx + HL) / 105 * 16, 0, 15))])


def pitch_control_grid(players, nx=21, ny=14, scale=9.0) -> np.ndarray:
    xs = (np.arange(nx) + .5) / nx * 105 - HL
    ys = (np.arange(ny) + .5) / ny * 68 - HW
    X, Y = np.meshgrid(xs, ys)
    h = np.zeros((ny, nx)); a = np.zeros((ny, nx))
    for p in players:
        e = np.exp(-np.hypot(X - p["x"], Y - p["y"]) / scale)
        if p["team"] == "home":
            h += e
        else:
            a += e
    return h / (h + a + 1e-9)


def detect_formation(players, team: str):
    pts = [p for p in players if p["team"] == team and p["role"] != "GK"]
    if len(pts) < 7:
        return None
    d = attack_dir(team)
    xs = sorted(p["x"] * d for p in pts)
    gaps = sorted(sorted(range(len(xs) - 1), key=lambda i: xs[i + 1] - xs[i], reverse=True)[:2])
    if len(gaps) < 2:
        return None
    return "-".join(map(str, [gaps[0] + 1, gaps[1] - gaps[0], len(xs) - gaps[1] - 1]))


class FormationVoter:
    def __init__(self, n=9): self.q = deque(maxlen=n)
    def update(self, f):
        if f:
            self.q.append(f)
        return Counter(self.q).most_common(1)[0][0] if self.q else "unknown"


def win_probability(sh, sa, xgh, xga, clock_s, total=5400.0):
    rem = max(0.0, 1 - clock_s / total)
    z = 1.1 * (sh - sa) / (0.4 + rem) + 0.5 * (xgh - xga)
    s = 1 / (1 + math.exp(-z))
    pd = max(0.05, 0.3 * math.exp(-abs(z) * 0.6))
    h, a = s * (1 - pd), (1 - s) * (1 - pd)
    return {"home": round(h, 4), "draw": round(pd, 4), "away": round(a, 4)}


class Kinematics:
    """Smoothed player and ball speeds (km/h) from successive positions."""
    def __init__(self): self.reset()

    def reset(self):
        self.last = {}; self.sp = {}; self.bh = deque(maxlen=4); self.bsp = 0.0

    def players(self, players, t):
        steps = {}
        for p in players:
            prev = self.last.get(p["id"])
            if prev and 0 < t - prev[2] <= 1.0:
                dt = t - prev[2]; step = math.hypot(p["x"] - prev[0], p["y"] - prev[1])
                v = min(step / dt * 3.6, 42.0)
                s = self.sp.get(p["id"], v); s += (v - s) * 0.35
                self.sp[p["id"]] = s; steps[p["id"]] = step
            p["speed"] = round(self.sp.get(p["id"], 0.0), 2)
            self.last[p["id"]] = (p["x"], p["y"], t)
        return steps

    def ball(self, b, t):
        self.bh.append((t, b["x"], b["y"], b["z"]))
        if len(self.bh) >= 3:
            a, c = self.bh[0], self.bh[-1]; dt = c[0] - a[0]
            if dt > 0:
                v = min(math.sqrt((c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2 + (c[3] - a[3]) ** 2) / dt * 3.6, 160.0)
                self.bsp += (v - self.bsp) * 0.5
        return round(self.bsp, 2)

    def ball_lost(self): self.bh.clear(); self.bsp = 0.0


class PlayerMetrics:
    def __init__(self): self.m = {}

    def update(self, pid, step, speed, dt):
        m = self.m.setdefault(pid, {"dist": 0.0, "hi": 0.0, "top": 0.0, "sprints": 0, "run": 0.0, "counted": False})
        m["dist"] += step; m["top"] = max(m["top"], speed)
        if speed >= 19.8:
            m["hi"] += step
        if speed >= 25:
            m["run"] += dt
            if m["run"] >= 0.5 and not m["counted"]:
                m["counted"] = True; m["sprints"] += 1
        elif speed < 22:
            m["run"] = 0.0; m["counted"] = False

    def snapshot(self):
        out = []
        for pid, m in sorted(self.m.items()):
            km = m["dist"] / 1000
            fat = min(1.0, 0.6 * km / 10 + 0.4 * (m["hi"] / 1000) / 1.5)   # estimate, not a physiological measure
            out.append({"id": pid, "distanceKm": round(km, 3), "topSpeed": round(m["top"], 1),
                        "sprints": m["sprints"], "fatigue": round(fat, 3)})
        return out
