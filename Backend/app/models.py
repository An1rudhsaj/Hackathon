"""Wire contract (schemaVersion 1). The pydantic models are the single source of truth; `python -m app.contract_export`
writes JSON Schemas to ../contract/. Coordinates in metres (pitch centre = origin, home attacks +x), speeds km/h."""
from __future__ import annotations
from typing import Literal, Optional

try:
    from pydantic import BaseModel, Field
    HAVE_PYDANTIC = True
except ImportError:                       # lets the engine/tests run without pydantic installed
    HAVE_PYDANTIC = False

MODELS: dict = {}

if HAVE_PYDANTIC:
    Team = Literal["home", "away"]
    EventType = Literal["pass", "shot", "save", "goal", "tackle", "foul", "card", "offside",
                        "corner", "throw_in", "goal_kick", "substitution"]

    class Xy(BaseModel):
        x: float
        y: float

    class Clock(BaseModel):
        period: Literal[1, 2]
        seconds: float

    class _Base(BaseModel):
        schemaVersion: Literal[1] = 1
        matchId: str
        seq: int = Field(ge=1)
        ts: int

    class TrackPlayer(BaseModel):
        id: str
        team: Team
        num: int
        role: Literal["GK", "DF", "MF", "FW"]
        x: float
        y: float
        speed: float
        conf: float

    class TrackBall(BaseModel):
        x: float
        y: float
        z: float
        speed: float
        airborne: bool
        conf: float

    class TrackingMessage(_Base):
        frame: int
        mediaTime: float = Field(ge=0)
        mediaSegment: int = 0               # increments after an RTSP reconnect (timeline discontinuity)
        clock: Clock
        players: list[TrackPlayer]
        ball: Optional[TrackBall] = None    # null when the ball is not observed
        possession: Optional[Team] = None
        holderId: Optional[str] = None

    class EventMessage(_Base):
        eventId: str
        revision: int = Field(ge=1)
        status: Literal["provisional", "confirmed", "retracted"]
        type: EventType
        clock: Clock
        mediaTime: float = Field(ge=0)
        team: Team
        playerId: Optional[str] = None
        targetPlayerId: Optional[str] = None
        start: Xy
        end: Optional[Xy] = None
        ballSpeed: Optional[float] = None
        distance: Optional[float] = None
        xg: Optional[float] = None
        outcome: Optional[Literal["goal", "saved", "off_target", "blocked", "complete", "incomplete"]] = None
        intoBox: Optional[bool] = None
        conf: float

    class Pair(BaseModel):
        home: float
        away: float

    class WinProb(BaseModel):
        home: float
        draw: float
        away: float

    class PlayerMetric(BaseModel):
        id: str
        distanceKm: float
        topSpeed: float
        sprints: int
        fatigue: float = Field(ge=0, le=1)

    class FastestShot(BaseModel):
        playerId: str
        speed: float

    class AnalyticsMessage(_Base):
        mediaTime: float = Field(ge=0)
        score: Pair
        possessionPct: Pair
        xg: Pair
        xt: Pair
        shots: Pair
        passes: Pair
        winProbability: WinProb
        formation: dict[str, str]
        pitchControl: Pair
        # 14 rows (y) x 21 columns (x); value = home share 0..1. Row 0 = y -34, column 0 = x -52.5.
        pitchControlGrid: Optional[list[list[float]]] = None
        fastestShot: Optional[FastestShot] = None
        playerMetrics: list[PlayerMetric]
        eventsThroughSeq: int = 0

    class CommentaryMessage(_Base):
        mediaTime: Optional[float] = None
        text: str
        personas: Optional[dict[str, str]] = None
        eventId: Optional[str] = None
        source: Literal["gemini", "template"]

    MODELS = {"tracking": TrackingMessage, "events": EventMessage, "analytics": AnalyticsMessage,
              "commentary": CommentaryMessage}


def validate(kind: str, d: dict) -> dict:
    """Validate against the contract (when pydantic is installed). Raises on contract violations."""
    m = MODELS.get(kind)
    return m.model_validate(d).model_dump(mode="json") if m else d
