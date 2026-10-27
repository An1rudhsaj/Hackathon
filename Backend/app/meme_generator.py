"""Feature 9: Viral Football Meme Generator.
Powered by Gemini 3.8 Flash (humor concepts) & Gemini Image Models (meme artwork).
"""
from __future__ import annotations
import base64
import json
import logging
import re
import time
from pathlib import Path

logger = logging.getLogger("meme_generator")


class MemeGenerator:
    def __init__(self, data_dir: Path, gemini_service):
        self.data_dir = Path(data_dir)
        self.memes_dir = self.data_dir / "memes"
        self.memes_dir.mkdir(parents=True, exist_ok=True)
        self.gemini = gemini_service

    async def generate_meme(self, event_data: dict, home_name: str = "Auckland FC",
                            away_name: str = "Newcastle Jets") -> dict:
        """Generate high-engagement viral football meme image, top/bottom text, and punchline caption."""
        player = event_data.get("player", "#10 Max Mata")
        speed = round(event_data.get("speed") or event_data.get("ballSpeed") or 86)
        minute = event_data.get("minute", 88)
        score = event_data.get("score", f"{home_name} 2-0 {away_name}")
        team = home_name if event_data.get("team") == "home" else away_name
        opp = away_name if event_data.get("team") == "home" else home_name

        prompt = (
            f"You are a viral football meme creator running an account with 5 million followers on Twitter/X, Instagram and TikTok.\n"
            f"A hilarious or dramatic match moment just occurred:\n"
            f"- Match: {home_name} vs {away_name} (Score: {score})\n"
            f"- Incident: {player} ({team}) scores a rocket at {speed} km/h in the {minute}'th minute leaving {opp} defenders frozen.\n\n"
            f"Generate a viral meme concept in JSON format:\n"
            f"{{\n"
            f'  "templateName": "Name of meme template e.g. Defense AFK / Disappearing Homer / Galaxy Brain / Shocked Pikachu",\n'
            f'  "topText": "Short classic top meme text (UPPERCASE, max 7 words)",\n'
            f'  "bottomText": "Punchline bottom meme text (UPPERCASE, max 7 words)",\n'
            f'  "headline": "Viral title with emojis",\n'
            f'  "caption": "Hilarious relatable caption for social media with emojis and hashtags",\n'
            f'  "visualPrompt": "A funny high-contrast cartoon or comic photo of football defenders looking completely confused and bewildered as a soccer ball streaks past at supersonic speed"\n'
            f"}}"
        )

        social_data = None
        if self.gemini and self.gemini.enabled:
            try:
                txt = await self.gemini._generate(prompt, json_mode=True)
                txt = re.sub(r"^```(?:json)?|```$", "", txt.strip()).strip()
                data = json.loads(txt)
                if isinstance(data, dict) and "topText" in data:
                    social_data = data
            except Exception as e:
                logger.warning(f"Gemini meme text generation error: {e}")

        if not social_data:
            social_data = {
                "templateName": "Defense Went Offline",
                "topText": f"WHEN YOU TELL DEFENDERS TO MARK #{player}",
                "bottomText": "AND THEY GIVE HIM 20 METERS OF SPACE",
                "headline": f"Bro had enough time to file his taxes before shooting 💀🚀",
                "caption": (
                    f"Newcastle defenders really watched him wind up from 25 yards like 'nah he won't shoot' 😭💀\n"
                    f"Spoiler: he shot it at {speed} km/h. RIP goalkeeper's gloves. 🪦🧤\n"
                    f"#FootballMemes #SundayLeagueVibes #RocketShot #ALeague"
                ),
                "visualPrompt": "A humorous cartoon illustration of four soccer defenders standing completely frozen looking shocked as a soccer ball blazes past with lightning flames",
                "hashtags": ["#FootballMemes", "#SundayLeague", "#PurePain", "#Golazo", "#RipKeeper"]
            }

        # Generate custom meme image with Gemini Image model
        meme_id = f"meme_{int(time.time())}"
        image_url = None
        if self.gemini and hasattr(self.gemini, "generate_image") and self.gemini.enabled:
            try:
                img_prompt = social_data.get("visualPrompt", "A funny meme photo of soccer defenders in shock")
                img_bytes = await self.gemini.generate_image(img_prompt)
                if img_bytes:
                    out_path = self.memes_dir / f"{meme_id}.jpg"
                    out_path.write_bytes(img_bytes)
                    image_url = f"/memes/{meme_id}.jpg"
            except Exception as e:
                logger.warning(f"Gemini meme image generation error: {e}")

        return {
            "ok": True,
            "memeId": meme_id,
            "templateName": social_data.get("templateName", "Viral Football Meme"),
            "topText": social_data.get("topText", "WHEN THE STRIKER SHOOTS"),
            "bottomText": social_data.get("bottomText", "AND THE DEFENSE IS AFK"),
            "headline": social_data.get("headline", "Defense left the chat 💀"),
            "caption": social_data.get("caption", ""),
            "imageUrl": image_url,
            "createdAt": time.time(),
        }
