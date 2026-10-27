"""Video / RTSP sources. One SourceManager owns every source's lifecycle:
queued -> probing -> starting -> running (-> reconnecting) -> completed | failed | stopped
Subprocesses are always started with argument arrays (never a shell). Credentials are never returned or logged."""
from __future__ import annotations
import asyncio
import ipaddress
import json
import re
import socket
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np

from .config import settings as S
from .vision import get_vision

TERMINAL = {"completed", "failed", "stopped"}
MAX_SOURCES = 3
PIPE, DEVNULL = asyncio.subprocess.PIPE, asyncio.subprocess.DEVNULL


class SourceError(Exception):
    def __init__(self, code: str, msg: str, status: int = 400):
        super().__init__(msg); self.code, self.msg, self.status = code, msg, status


def redact(url: str) -> str:
    """rtsp://user:pass@host:554/path?token=x  ->  rtsp://host:554/path   (no userinfo, no query)"""
    try:
        u = urlsplit(url)
        return f"{u.scheme}://{u.hostname}{':' + str(u.port) if u.port else ''}{u.path}"
    except Exception:
        return "rtsp://<invalid>"


def validate_rtsp(url: str) -> None:
    if not S.rtsp_enabled:
        raise SourceError("rtsp_disabled", "RTSP is not enabled on this server", 403)
    if len(url) > 1024 or any(c in url for c in " \r\n\t\x00"):
        raise SourceError("bad_url", "Invalid RTSP URL", 400)
    u = urlsplit(url)
    if u.scheme not in ("rtsp", "rtsps") or not u.hostname:
        raise SourceError("bad_url", "URL must look like rtsp://host:port/path", 400)
    host, port = u.hostname, u.port or 554
    if S.rtsp_allowlist and host not in S.rtsp_allowlist and f"{host}:{port}" not in S.rtsp_allowlist:
        raise SourceError("not_allowed", "This RTSP host is not on the allowlist", 403)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except OSError:
        raise SourceError("unresolvable", "RTSP host could not be resolved", 400)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback and not S.rtsp_allow_loopback:
            raise SourceError("blocked_address", "Loopback addresses are blocked", 403)
        if ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved:     # includes 169.254.169.254 metadata
            raise SourceError("blocked_address", "This address range is blocked", 403)
        if ip.is_private and not ip.is_loopback and not S.rtsp_allow_private:
            raise SourceError("blocked_address", "Private network addresses are blocked on this server", 403)


async def _run(cmd, timeout):
    p = await asyncio.create_subprocess_exec(*cmd, stdin=DEVNULL, stdout=PIPE, stderr=PIPE)
    try:
        out, err = await asyncio.wait_for(p.communicate(), timeout)
    except asyncio.TimeoutError:
        p.kill(); await p.wait()
        raise SourceError("timeout", "Timed out while probing the source", 504)
    return p.returncode, out, err


async def probe_media(target: str, rtsp: bool = False) -> dict:
    cmd = [S.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
           "stream=codec_name,width,height:format=duration", "-of", "json"]
    if rtsp:
        cmd += ["-rtsp_transport", "tcp"]
    rc, out, _ = await _run(cmd + [target], 15 if rtsp else 60)
    if rc != 0:
        raise SourceError("unreachable" if rtsp else "unreadable",
                          "Could not connect to the RTSP stream (unreachable, wrong credentials or timeout)" if rtsp
                          else "The file could not be read as a video", 400)
    d = json.loads(out or b"{}")
    st = (d.get("streams") or [None])[0]
    if not st or not st.get("width"):
        raise SourceError("no_video", "No video stream found", 400)
    dur = float((d.get("format") or {}).get("duration") or 0) or None
    if not rtsp:
        if not dur:
            raise SourceError("no_duration", "Could not determine the video duration", 400)
        if dur > S.upload_max_seconds:
            raise SourceError("too_long", f"Video is longer than the {int(S.upload_max_seconds)} s limit", 413)
    return {"width": int(st["width"]), "height": int(st["height"]), "codec": st.get("codec_name"), "duration": dur}


def scaled(w: int, h: int):
    W = min(S.proc_width, w) // 2 * 2
    return W, max(2, round(W * h / w / 2) * 2)


@dataclass
class Source:
    id: str
    kind: str                       # upload | rtsp
    match_id: str
    width: int
    height: int
    duration: float | None
    hls_dir: Path
    path: Path | None = None
    url: str = ""                   # PRIVATE: may contain credentials, never serialised
    label: str = ""
    state: str = "queued"
    message: str = "Queued"
    progress: float = 0.0
    error: dict | None = None
    frames: int = 0
    reconnects: int = 0
    approx: bool = False
    gemini: str = "off"
    created: float = field(default_factory=time.time)
    task: asyncio.Task | None = None
    procs: list = field(default_factory=list)
    session: object = None
    stderr: deque = field(default_factory=lambda: deque(maxlen=15))

    def public(self) -> dict:
        hls_ready = (self.hls_dir / "index.m3u8").exists()
        segments = len(list(self.hls_dir.glob("*.ts"))) if self.hls_dir.exists() else 0
        return {
            "sourceId": self.id,
            "matchId": self.match_id,
            "kind": self.kind,
            "state": self.state,
            "message": self.message,
            "progress": round(self.progress, 4),
            "error": self.error,
            "running": self.state in ("starting", "running", "probing", "queued", "live"),
            "ready": hls_ready,
            "hlsUrl": f"/hls/{self.id}/index.m3u8",
            "hls": {
                "ready": hls_ready,
                "manifest": f"/hls/{self.id}/index.m3u8",
                "segments": segments,
                "error": None,
            },
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "framesProcessed": self.frames,
            "reconnects": self.reconnects,
            "label": self.label,
            "approximateCalibration": self.approx,
            "geminiSummary": self.gemini,
            "createdAt": self.created,
            "startedAt": self.created,
            "endedAt": None if self.state not in TERMINAL else time.time(),
            "teams": {
                "home": {"name": S.home_name, "color": S.home_color},
                "away": {"name": S.away_name, "color": S.away_color},
            },
        }


class SourceManager:
    def __init__(self, make_session, notify, gemini):
        self.make_session, self.notify, self.gemini = make_session, notify, gemini
        self.sources: dict[str, Source] = {}
        self.hls_root = S.data_dir / "hls"
        self.hls_root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ creation
    def _check_capacity(self):
        if sum(1 for s in self.sources.values() if s.state not in TERMINAL) >= MAX_SOURCES:
            raise SourceError("busy", "Too many sources are running; stop one first", 429)

    def create_upload(self, path: Path, info: dict, match_id: str, label: str) -> Source:
        self._check_capacity()
        sid = uuid.uuid4().hex[:16]
        src = Source(sid, "upload", match_id, info["width"], info["height"], info["duration"], self.hls_root / sid,
                     path=path, label=label[:80])
        src.hls_dir.mkdir(parents=True, exist_ok=True)
        self.sources[sid] = src
        src.task = asyncio.create_task(self._run_upload(src))
        return src

    def create_rtsp(self, url: str, info: dict, match_id: str) -> Source:
        self._check_capacity()
        sid = uuid.uuid4().hex[:16]
        src = Source(sid, "rtsp", match_id, info["width"], info["height"], None, self.hls_root / sid, url=url, label=redact(url))
        src.hls_dir.mkdir(parents=True, exist_ok=True)
        self.sources[sid] = src
        src.task = asyncio.create_task(self._run_rtsp(src))
        return src

    # ------------------------------------------------------------------ helpers
    async def _set(self, src, state=None, msg=None, **kw):
        if state:
            src.state = state
        if msg is not None:
            src.message = msg
        for k, v in kw.items():
            setattr(src, k, v)
        try:
            await self.notify(src.match_id, src.public())
        except Exception:
            pass

    async def _spawn(self, src, cmd, stdout):
        p = await asyncio.create_subprocess_exec(*cmd, stdin=DEVNULL, stdout=stdout, stderr=PIPE)
        src.procs.append(p)

        async def drain():
            try:
                while True:
                    line = await p.stderr.readline()
                    if not line:
                        return
                    src.stderr.append(line.decode(errors="replace").strip()[:300])
            except Exception:
                return
        asyncio.create_task(drain())
        return p

    @staticmethod
    async def _kill(p):
        """Terminate, then kill after 3 s. Polling (not wait_for) so it also works while the calling task is being cancelled."""
        if p.returncode is not None:
            return
        try:
            p.terminate()
        except ProcessLookupError:
            return
        for _ in range(15):
            if p.returncode is not None:
                return
            await asyncio.sleep(0.1)
        try:
            p.kill()
        except ProcessLookupError:
            return
        for _ in range(30):
            if p.returncode is not None:
                return
            await asyncio.sleep(0.1)

    async def _kill_all(self, src):
        for p in src.procs:
            await self._kill(p)
        src.procs.clear()

    def _hls_args(self, src, live):
        a = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "48", "-sc_threshold", "0",
             "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", str(S.hls_time)]
        a += (["-hls_list_size", "6", "-hls_flags", "delete_segments+append_list"] if live
              else ["-hls_list_size", "0", "-hls_playlist_type", "event"])
        return a + ["-hls_segment_filename", str(src.hls_dir / "seg_%05d.ts"), str(src.hls_dir / "index.m3u8")]

    def _decode_args(self, w, h):
        return ["-vf", f"fps={S.proc_fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"]

    def _fail(self, e: Exception):
        if isinstance(e, SourceError):
            return {"code": e.code, "message": e.msg}
        return {"code": "internal", "message": f"{type(e).__name__}: {str(e)[:200]}"}

    # ------------------------------------------------------------------ upload: process as fast as hardware allows
    async def _run_upload(self, src: Source):
        session = None
        try:
            await self._set(src, "probing", "Checking video")
            w, h = scaled(src.width, src.height)
            await self._set(src, "starting", "Starting analysis")
            session = src.session = self.make_session(src.match_id, "batch", 1.0)
            vision = await asyncio.to_thread(get_vision, w, h, S, S.proc_fps)
            src.approx = bool(getattr(vision, "approximate_calibration", False))
            target = str(src.path)
            hls = await self._spawn(src, [S.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", target,
                                          "-map", "0:v:0", "-map", "0:a:0?"] + self._hls_args(src, False), DEVNULL)
            dec = await self._spawn(src, [S.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", target,
                                          "-map", "0:v:0", "-an"] + self._decode_args(w, h), PIPE)
            fb, idx = w * h * 3, 0
            while True:
                try:
                    buf = await dec.stdout.readexactly(fb)
                except asyncio.IncompleteReadError:
                    break
                t = idx / S.proc_fps
                fr = await asyncio.to_thread(vision.process, idx, t, np.frombuffer(buf, np.uint8).reshape(h, w, 3))
                await session.push(fr)
                idx += 1; src.frames = idx
                if idx == 1:
                    await self._set(src, "running", "Analysing")
                elif idx % 50 == 0:
                    await self._set(src, progress=min(0.999, t / src.duration))
            if idx == 0:
                raise SourceError("no_frames", "No frames could be decoded: " + (" | ".join(src.stderr)[-200:] or "unknown error"), 422)
            await session.finalize()
            try:
                rc = await asyncio.wait_for(hls.wait(), max(60, (src.duration or 0) * 3))
            except asyncio.TimeoutError:
                rc = None
            await self._set(src, "completed", "Analysis complete" + ("" if rc == 0 else " (video preview incomplete)"), progress=1.0)
            if S.gemini_video_summary and self.gemini and self.gemini.enabled:
                asyncio.create_task(self._gemini_summary(src))
        except asyncio.CancelledError:
            if session:
                await session.finalize()
            await self._set(src, "stopped", "Stopped")
            raise
        except Exception as e:
            if session:
                await session.finalize()
            await self._set(src, "failed", "Failed: " + self._fail(e)["message"], error=self._fail(e))
        finally:
            await self._kill_all(src)

    async def _gemini_summary(self, src: Source):
        await self._set(src, gemini="pending")
        data = await self.gemini.analyze_video(src.path, S.home_name, S.away_name)
        if data and src.session:
            src.session.results["moments"] = data.get("moments", [])
            src.session.results["summary"] = data.get("summary")
            await self._set(src, gemini="done")
        else:
            await self._set(src, gemini="failed")

    # ------------------------------------------------------------------ rtsp: live, bounded reconnect, one ffmpeg for HLS + analysis
    async def _run_rtsp(self, src: Source):
        session = None
        try:
            await self._set(src, "probing", "Connecting to camera")
            w, h = scaled(src.width, src.height)
            session = src.session = self.make_session(src.match_id, "live", 1.0)
            vision = await asyncio.to_thread(get_vision, w, h, S, S.proc_fps)
            src.approx = bool(getattr(vision, "approximate_calibration", False))
            await self._set(src, "starting", "Starting analysis")
            fb, attempts, t_base, segment = w * h * 3, 0, 0.0, 0
            while True:
                cmd = [S.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-rtsp_transport", "tcp", "-i", src.url,
                       "-map", "0:v:0", "-map", "0:a:0?"] + self._hls_args(src, True) + \
                      ["-map", "0:v:0", "-an"] + self._decode_args(w, h)
                proc = await self._spawn(src, cmd, PIPE)
                latest, ev, got = [None], asyncio.Event(), [0]

                async def drain(proc=proc, latest=latest, ev=ev, got=got):       # keeps the pipe empty so ffmpeg never blocks
                    try:
                        while True:
                            latest[0] = await proc.stdout.readexactly(fb); got[0] += 1; ev.set()
                    except (asyncio.IncompleteReadError, ConnectionError):
                        ev.set()
                dtask = asyncio.create_task(drain())
                started, seen, last_t = time.monotonic(), 0, t_base
                try:
                    while True:
                        await asyncio.wait_for(ev.wait(), 15)                    # 15 s without frames = connection lost
                        ev.clear()
                        if got[0] == seen:
                            if dtask.done():
                                break
                            continue
                        seen = got[0]
                        last_t = t_base + (time.monotonic() - started)
                        fr = await asyncio.to_thread(vision.process, src.frames, last_t, np.frombuffer(latest[0], np.uint8).reshape(h, w, 3))
                        fr["segment"] = segment
                        await session.push(fr)
                        src.frames += 1
                        if src.state != "running":
                            await self._set(src, "running", "Live")
                except asyncio.TimeoutError:
                    pass
                finally:
                    dtask.cancel()
                    await self._kill(proc)
                if seen > 0:
                    attempts = 0
                attempts += 1
                if attempts > S.rtsp_max_reconnects:
                    raise SourceError("reconnect_exhausted", "Camera connection lost and reconnect attempts were exhausted", 502)
                segment += 1; t_base = last_t + 0.5; src.reconnects += 1
                await self._set(src, "reconnecting", f"Connection lost, retrying ({attempts}/{S.rtsp_max_reconnects})")
                await asyncio.sleep(min(2 ** attempts, 15))
        except asyncio.CancelledError:
            if session:
                await session.finalize()
            await self._set(src, "stopped", "Stopped")
            raise
        except Exception as e:
            if session:
                await session.finalize()
            await self._set(src, "failed", "Failed: " + self._fail(e)["message"], error=self._fail(e))
        finally:
            await self._kill_all(src)

    # ------------------------------------------------------------------ control
    async def stop(self, sid: str) -> Source:
        src = self.sources.get(sid)
        if not src:
            raise KeyError(sid)
        if src.state in TERMINAL:
            return src                                    # idempotent
        if src.task:
            src.task.cancel()
            try:
                await src.task
            except (asyncio.CancelledError, Exception):
                pass
        await self._kill_all(src)
        if src.state not in TERMINAL:
            await self._set(src, "stopped", "Stopped")
        return src

    async def shutdown(self):
        for sid in list(self.sources):
            try:
                await self.stop(sid)
            except Exception:
                pass
