"""Settings from environment / .env (stdlib only)."""
from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: str) -> None:
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.split("  #")[0].strip()          # allow trailing "  # comment"
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        val = v.strip().strip('"').strip("'")
        if val:
            os.environ.setdefault(k.strip(), val)


def _s(n, d=""): return os.environ.get(n, d)
def _i(n, d): return int(os.environ.get(n) or d)
def _f(n, d): return float(os.environ.get(n) or d)
def _b(n, d):
    v = os.environ.get(n)
    return d if v is None or v == "" else v.strip().lower() in ("1", "true", "yes", "on")
def _l(n, d=""): return [x.strip() for x in (os.environ.get(n) or d).split(",") if x.strip()]


@dataclass
class Settings:
    api_key: str = ""
    allow_anon_token: bool = True
    token_ttl: int = 900
    cors_origins: tuple[str, ...] = ("http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173")
    data_dir: Path = Path("./data")
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_interval: float = 8.0
    gemini_video_summary: bool = False
    vision_backend: str = "mock"
    yolo_model: str = "yolo11n.pt"
    yolo_tracker: str = "bytetrack.yaml"
    yolo_imgsz: int = 960
    yolo_conf: float = 0.25
    yolo_device: str = ""
    proc_fps: float = 25.0
    proc_width: int = 1280
    pitch_quad: tuple | None = None
    home_kit_rgb: tuple | None = None
    upload_max_mb: int = 2048
    upload_max_seconds: float = 7200
    rtsp_enabled: bool = True
    rtsp_allow_private: bool = True
    rtsp_allow_loopback: bool = False
    rtsp_allowlist: tuple = ()
    rtsp_max_reconnects: int = 5
    hls_time: int = 2
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    sim_clock_scale: float = 10.0
    results_fps: float = 10.0
    tracking_max_hz: float = 25.0
    home_name: str = "Auckland FC"
    away_name: str = "Newcastle Jets"
    home_color: str = "#3b82f6"
    away_color: str = "#eab308"
    dashboard_dir: str = ""


def _nums(name, n):
    raw = _s(name).strip()
    if not raw:
        return None
    vals = [float(x) for x in raw.split(",")]
    if len(vals) != n:
        raise ValueError(f"{name} needs {n} comma-separated numbers")
    return tuple(vals)


def load_settings(env_file: str = ".env") -> Settings:
    _load_dotenv(env_file)
    dash_dir = _s("DASHBOARD_DIR")
    if not dash_dir:
        cand = Path("../Dashboard")
        if cand.is_dir():
            dash_dir = str(cand.resolve())
    cors_default = "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:5500,http://127.0.0.1:5500"
    return Settings(
        api_key=_s("API_KEY"), allow_anon_token=_b("ALLOW_ANON_TOKEN", True), token_ttl=_i("TOKEN_TTL_SECONDS", 900),
        cors_origins=tuple(_l("CORS_ORIGINS", cors_default)),
        data_dir=Path(_s("DATA_DIR", "./data")),
        gemini_api_key=os.environ.get("GEMINI_API_KEY") or _s("GEMINI_API_KEY"),
        gemini_model=_s("GEMINI_MODEL", "gemini-3.8-flash"),
        gemini_interval=_f("GEMINI_COMMENTARY_INTERVAL", 8), gemini_video_summary=_b("GEMINI_VIDEO_SUMMARY", False),
        vision_backend=_s("VISION_BACKEND", "mock"), yolo_model=_s("YOLO_MODEL", "yolo11n.pt"),
        yolo_imgsz=_i("YOLO_IMGSZ", 960), yolo_conf=_f("YOLO_CONF", 0.25), yolo_device=_s("YOLO_DEVICE"),
        proc_fps=_f("PROC_FPS", 25), proc_width=_i("PROC_WIDTH", 1280),
        pitch_quad=_nums("PITCH_QUAD", 8), home_kit_rgb=_nums("HOME_KIT_RGB", 3),
        upload_max_mb=_i("UPLOAD_MAX_MB", 2048), upload_max_seconds=_f("UPLOAD_MAX_SECONDS", 7200),
        rtsp_enabled=_b("RTSP_ENABLED", True), rtsp_allow_private=_b("RTSP_ALLOW_PRIVATE", True),
        rtsp_allow_loopback=_b("RTSP_ALLOW_LOOPBACK", False), rtsp_allowlist=tuple(_l("RTSP_ALLOWLIST")),
        rtsp_max_reconnects=_i("RTSP_MAX_RECONNECTS", 5), hls_time=_i("HLS_SEGMENT_SECONDS", 2),
        ffmpeg=_s("FFMPEG", "ffmpeg"), ffprobe=_s("FFPROBE", "ffprobe"),
        sim_clock_scale=_f("SIM_CLOCK_SCALE", 10), results_fps=_f("RESULTS_FPS", 10),
        tracking_max_hz=_f("TRACKING_MAX_HZ", 25), home_name=_s("HOME_NAME", "Auckland FC"),
        away_name=_s("AWAY_NAME", "Newcastle Jets"), home_color=_s("HOME_COLOR", "#3b82f6"),
        away_color=_s("AWAY_COLOR", "#eab308"), dashboard_dir=dash_dir,
    )


settings = load_settings()
