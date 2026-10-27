"""Pitch geometry. Origin = pitch centre. x = along length (-52.5..52.5), y = across (-34..34), metres.
Home attacks +x, away attacks -x."""
from __future__ import annotations
import math
import numpy as np

HL, HW = 52.5, 34.0
GOAL_HALF, GOAL_H = 3.66, 2.44
BOX_DEPTH, BOX_HALF = 16.5, 20.15


def attack_dir(team: str) -> int: return 1 if team == "home" else -1
def other(team: str) -> str: return "away" if team == "home" else "home"
def dist(a, b) -> float: return math.hypot(a[0] - b[0], a[1] - b[1])
def clamp(v, lo, hi): return lo if v < lo else hi if v > hi else v
def in_box(x: float, y: float, team: str) -> bool:
    """True if (x, y) is inside the penalty box that `team` attacks."""
    return x * attack_dir(team) >= HL - BOX_DEPTH and abs(y) <= BOX_HALF


class Homography:
    def __init__(self, H): self.H = np.asarray(H, float)

    @staticmethod
    def fit(src, dst) -> "Homography":
        A = []
        for (x, y), (u, v) in zip(src, dst):
            A.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
            A.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
        _, _, vt = np.linalg.svd(np.asarray(A, float))
        H = vt[-1].reshape(3, 3)
        return Homography(H / H[2, 2])

    def apply(self, x: float, y: float):
        p = self.H @ np.array([x, y, 1.0])
        return float(p[0] / p[2]), float(p[1] / p[2])


class PitchMapper:
    """Pixel -> pitch metres. With `quad` (8 numbers: far-left, far-right, near-right, near-left pitch corners in
    pixels) a real homography is used. Without it the frame is assumed to cover the whole pitch (APPROXIMATE).
    Automatic calibration needs a trained pitch-keypoint model: plug it in by producing the quad per frame."""

    CORNERS = [(-HL, -HW), (HL, -HW), (HL, HW), (-HL, HW)]

    def __init__(self, w: int, h: int, quad=None):
        self.w, self.h = w, h
        self.approximate = quad is None
        self.H = None
        if quad is not None:
            pts = [(quad[i], quad[i + 1]) for i in range(0, 8, 2)]
            self.H = Homography.fit(pts, self.CORNERS)

    def to_pitch(self, px: float, py: float):
        if self.H is not None:
            return self.H.apply(px, py)
        return (px / self.w - 0.5) * 2 * HL, (py / self.h - 0.5) * 2 * HW
