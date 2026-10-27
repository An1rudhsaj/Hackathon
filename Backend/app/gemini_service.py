"""Gemini integration (google-genai SDK). Everything degrades gracefully when no key is configured.
Uses: (1) live commentary text, (2) video understanding of an uploaded file -> key moments + summary."""
from __future__ import annotations
import asyncio
import json
import re
import time
from pathlib import Path


class GeminiService:
    def __init__(self, api_key: str, model: str):
        self.model = model
        self.enabled = bool(api_key)
        self._key = api_key
        self._client = None
        self._sem = asyncio.Semaphore(2)
        self._last_error = None

    def _c(self):
        if self._client is None:
            from google import genai                      # pip install google-genai
            self._client = genai.Client(api_key=self._key)
        return self._client

    async def _generate(self, contents, json_mode=False):
        from google.genai import types
        cfg = types.GenerateContentConfig(response_mime_type="application/json") if json_mode else None
        candidates = [self.model, "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash"]
        # keep unique in order
        seen = set()
        models = [m for m in candidates if m and not (m in seen or seen.add(m))]
        last_exc = None
        for mod in models:
            try:
                async with self._sem:
                    r = await asyncio.wait_for(self._c().aio.models.generate_content(model=mod, contents=contents, config=cfg), 60)
                txt = (r.text or "").strip()
                if txt:
                    return txt
            except Exception as e:
                last_exc = e
                self._last_error = f"{type(e).__name__}: {e}"[:200]
                continue
        if last_exc:
            raise last_exc
        return ""

    async def generate_audio(self, text: str) -> bytes | None:
        """Generate native speech audio using Gemini TTS model."""
        if not self.enabled or not text:
            return None
        from google.genai import types
        cfg = types.GenerateContentConfig(response_modalities=["AUDIO"])
        tts_models = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"]
        for mod in tts_models:
            try:
                async with self._sem:
                    resp = await asyncio.wait_for(
                        self._c().aio.models.generate_content(model=mod, contents=text, config=cfg), 40
                    )
                for part in resp.candidates[0].content.parts:
                    if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                        return part.inline_data.data
            except Exception as e:
                self._last_error = f"TTS {mod}: {e}"[:200]
                continue
        return None

    async def generate_image(self, prompt: str) -> bytes | None:
        """Generate high-impact action poster using Gemini image model."""
        if not self.enabled or not prompt:
            return None
        from google.genai import types
        cfg = types.GenerateContentConfig(response_modalities=["IMAGE"])
        img_models = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image", "gemini-2.5-flash-image"]
        for mod in img_models:
            try:
                async with self._sem:
                    resp = await asyncio.wait_for(
                        self._c().aio.models.generate_content(model=mod, contents=prompt, config=cfg), 40
                    )
                for part in resp.candidates[0].content.parts:
                    if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                        return part.inline_data.data
            except Exception as e:
                self._last_error = f"IMG {mod}: {e}"[:200]
                continue
        return None

    async def commentary(self, ctx: dict, with_audio: bool = False, audio_persona: str = "hype") -> dict | None:
        """-> dict with keys 'tactical', 'hype', 'radio', and optional 'audioUrl' or None (falls back to template)."""
        if not self.enabled:
            return None
        lang = ctx.get("language", "English")
        lang_instruction = f"\nIMPORTANT: Write all three commentary personas natively, fluently, and authentically in {lang} using local football idioms and commentary phrases." if lang != "English" else ""
        prompt = (
            "You are a live football broadcast commentary engine. Based only on the provided facts, "
            "write commentary in 3 distinct broadcast personas as JSON:\n"
            "- 'tactical': 1-2 analytical sentences focusing on positioning, ball speed, and tactical shape.\n"
            "- 'hype': 1-2 high-energy, exciting sentences with emojis tailored for Gen-Z streamer/social audiences.\n"
            "- 'radio': 1-2 descriptive, concise play-by-play sentences for radio/audio broadcast.\n"
            f"Do not invent names, scores or stats not in the facts.{lang_instruction}\n"
            "Return JSON only: {\"tactical\": \"...\", \"hype\": \"...\", \"radio\": \"...\"}\n" + json.dumps(ctx)
        )
        try:
            txt = await self._generate(prompt, json_mode=True)
            txt = re.sub(r"^```(?:json)?|```$", "", txt.strip()).strip()
            data = json.loads(txt)
            if not (isinstance(data, dict) and "tactical" in data):
                data = {"tactical": txt[:300], "hype": txt[:300], "radio": txt[:300]}

            if with_audio:
                import base64
                spoken_text = data.get(audio_persona) or data.get("hype") or data.get("tactical")
                audio_bytes = await self.generate_audio(spoken_text)
                if audio_bytes:
                    b64 = base64.b64encode(audio_bytes).decode("utf-8")
                    data["audioUrl"] = f"data:audio/wav;base64,{b64}"
                    data["audioMime"] = "audio/wav"
            return data
        except Exception as e:                            # rate limit, network, bad model name...
            self._last_error = f"{type(e).__name__}: {e}"[:200]
            return None

    async def analyze_video(self, path: Path, home: str, away: str):
        """Upload a video to the Gemini File API and ask for summary + key moments. Returns dict or None."""
        if not self.enabled:
            return None
        client = self._c()
        f = None
        try:
            f = await client.aio.files.upload(file=str(path))
            t0 = time.time()
            while getattr(f.state, "name", str(f.state)) == "PROCESSING":
                if time.time() - t0 > 300:
                    raise TimeoutError("Gemini file processing timed out")
                await asyncio.sleep(3)
                f = await client.aio.files.get(name=f.name)
            if getattr(f.state, "name", "") == "FAILED":
                raise RuntimeError("Gemini could not process the video")
            prompt = (f"This is football match footage ({home} vs {away}). Return JSON only: "
                      '{"summary": str, "moments": [{"time": "mm:ss", "type": "goal|shot|save|pass|tackle|foul|corner|offside|card", '
                      '"team": "home|away|unknown", "description": str}]}. Only list moments you can actually see.')
            txt = await self._generate([f, prompt], json_mode=True)
            data = json.loads(re.sub(r"^```(?:json)?|```$", "", txt.strip()).strip())
            for m in data.get("moments", []):
                try:
                    mm, ss = str(m.get("time", "0:0")).split(":")[-2:]
                    m["seconds"] = int(mm) * 60 + int(ss)
                except Exception:
                    m["seconds"] = None
            return data
        except Exception as e:
            self._last_error = f"{type(e).__name__}: {e}"[:200]
            return None
        finally:
            if f is not None:
                try:
                    await client.aio.files.delete(name=f.name)
                except Exception:
                    pass
