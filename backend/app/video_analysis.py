
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from scenedetect import ContentDetector, open_video, SceneManager

APP_DIR = Path(__file__).resolve().parent
VIDEO_DIR = APP_DIR.parent / "data" / "videos"
VIDEO_DIR.mkdir(parents=True, exist_ok=True)

FFPROBE = os.getenv("FFPROBE_PATH", "ffprobe")


def get_video_metadata(video_path: str | Path) -> dict[str, Any]:
    """Read actual duration and stream metadata using FFprobe."""
    path = Path(video_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Video file not found: {path}")

    result = subprocess.run(
        [
            FFPROBE,
            "-v", "error",
            "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name,width,height",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )

    data = json.loads(result.stdout)
    duration = float(data.get("format", {}).get("duration", 0))

    return {
        "filename": path.name,
        "duration_seconds": round(duration),
        "format_name": data.get("format", {}).get("format_name"),
        "streams": data.get("streams", []),
    }


def detect_scenes(
    video_path: str | Path,
    threshold: float = 15.0,
    minimum_scene_seconds: float = 0.7,
) -> list[dict[str, Any]]:
    """Find candidate scene boundaries; these are not verified match events."""
    path = Path(video_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Video file not found: {path}")

    video = open_video(str(path))
    manager = SceneManager()
    manager.add_detector(
        ContentDetector(
            threshold=threshold,
            min_scene_len=max(1, round(minimum_scene_seconds * float(video.frame_rate))),
        )
    )
    manager.detect_scenes(video, show_progress=False)

    scenes = manager.get_scene_list()
    candidates = []

    for index, (start, end) in enumerate(scenes, start=1):
        start_seconds = round(start.get_seconds(), 3)
        end_seconds = round(end.get_seconds(), 3)
        candidates.append(
            {
                "candidate_number": index,
                "start_seconds": start_seconds,
                "end_seconds": end_seconds,
                "duration_seconds": round(end_seconds - start_seconds, 3),
                "candidate_type": "scene_change",
                "verified": False,
            }
        )

    return candidates
