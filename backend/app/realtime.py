from __future__ import annotations

import os
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/live", tags=["real-time tracking"])
_lock = threading.RLock()
_worker: threading.Thread | None = None
_stop = threading.Event()
_process: subprocess.Popen | None = None

_state: dict[str, Any] = {
    "status": "idle", "source_url": None, "source_type": None, "started_at": None,
    "error": None, "frame_width": None, "frame_height": None, "fps_estimate": None,
    "frame_timestamp_seconds": None, "frame_sequence": 0, "detections": [],
    "model": "yolo11n.pt", "note": "No source connected. Configure a video source to begin analysis.",
}

class StartBody(BaseModel):
    source_url: str = Field(min_length=3, max_length=2048)
    confidence_threshold: float = Field(default=0.45, ge=0.05, le=0.95)
    inference_fps: float = Field(default=4.0, ge=0.5, le=15.0)

def _ffmpeg_path() -> str:
    configured = os.getenv("FIRESIGHT_FFMPEG_PATH")
    if configured and Path(configured).is_file():
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    local_app_data = os.getenv("LOCALAPPDATA", "")
    candidate = Path(local_app_data) / "Microsoft/WinGet/Packages/Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build-shared/bin/ffmpeg.exe"
    if candidate.is_file():
        return str(candidate)
    raise RuntimeError("FFmpeg was not found. Install FFmpeg or set FIRESIGHT_FFMPEG_PATH.")

def _resolve_source(value: str) -> tuple[str, str]:
    value = value.strip()
    local_path = Path(value)
    if local_path.is_file():
        if local_path.suffix.lower() not in {".webm", ".mp4", ".mkv", ".mov", ".avi", ".m4v"}:
            raise HTTPException(status_code=422, detail="Unsupported local video extension.")
        return str(local_path.resolve()), "local_video"
    parsed = urlparse(value)
    if parsed.scheme.lower() not in {"rtsp", "rtsps", "http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Supply an existing local video path or an RTSP/RTSPS/HTTP(S) URL.")
    if ".m3u8" in parsed.path.lower():
        return value, "hls"
    if parsed.scheme.lower() in {"rtsp", "rtsps"}:
        return value, "rtsp"
    return value, "http_stream"

def _tracking_loop(source: str, source_type: str, confidence_threshold: float, inference_fps: float) -> None:
    global _state, _process
    process: subprocess.Popen | None = None
    try:
        import numpy as np
        from ultralytics import YOLO
        ffmpeg = _ffmpeg_path()
        model_name = os.getenv("FIRESIGHT_YOLO_MODEL", "yolo11n.pt")
        model = YOLO(model_name)
        width, height = 960, 540
        frame_bytes = width * height * 3
        # `showinfo` emits the actual timestamp for each sampled output frame. Read
        # stderr concurrently so every raw frame can be paired with its source PTS.
        command = [ffmpeg, "-hide_banner", "-loglevel", "info"]
        command += ["-i", source, "-an", "-vf", f"fps={inference_fps},scale={width}:{height},showinfo", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=frame_bytes * 2)
        pts_queue: queue.Queue[float] = queue.Queue()
        def read_pts() -> None:
            if process is None or process.stderr is None:
                return
            for line in iter(process.stderr.readline, b""):
                match = re.search(rb"\bpts_time:([+-]?(?:\d+(?:\.\d*)?|\.\d+))", line)
                if match:
                    try:
                        pts_queue.put(float(match.group(1)))
                    except ValueError:
                        continue
        threading.Thread(target=read_pts, daemon=True).start()
        with _lock:
            _process = process
            _state.update(status="running", error=None, model=model_name, frame_width=width, frame_height=height,
                fps_estimate=inference_fps, note="Analyzing video using FFmpeg source presentation timestamps (PTS).")
        sequence = 0
        while not _stop.is_set():
            if process.stdout is None:
                raise RuntimeError("FFmpeg frame output is unavailable.")
            raw = process.stdout.read(frame_bytes)
            if len(raw) == 0:
                if process.poll() is not None:
                    if source_type == "local_video":
                        with _lock:
                            _state.update(status="completed", note="Video reached EOF.")
                        break
                    raise RuntimeError("FFmpeg ended the network stream without producing more frames.")
                time.sleep(0.05)
                continue
            if len(raw) != frame_bytes:
                raise RuntimeError(f"FFmpeg returned an incomplete frame ({len(raw)} of {frame_bytes} bytes).")
            frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3))
            result = model.track(frame, persist=True, tracker="bytetrack.yaml", conf=confidence_threshold,
                classes=[0, 32], verbose=False)[0]
            sequence += 1
            # Match this raw frame to FFmpeg's source presentation timestamp (PTS).
            # Never substitute inference wall time or sequence/fps if PTS is missing.
            try:
                timestamp = pts_queue.get(timeout=2.0)
            except queue.Empty:
                raise RuntimeError("FFmpeg did not provide a source timestamp for an analyzed frame; refusing to publish unsynchronized detections.")
            items: list[dict[str, Any]] = []
            boxes, names = result.boxes, result.names
            if boxes is not None:
                for box in boxes:
                    xyxy = [round(float(v), 2) for v in box.xyxy[0].tolist()]
                    class_id = int(box.cls[0].item())
                    confidence = round(float(box.conf[0].item()), 3)
                    track_id = int(box.id[0].item()) if box.id is not None else None
                    label = str(names.get(class_id, f"class_{class_id}"))
                    # Filter weak person detections more aggressively; keep ball threshold conservative.
                    if class_id == 0 and confidence < max(confidence_threshold, 0.45):
                        continue
                    if class_id == 32 and confidence < max(confidence_threshold, 0.50):
                        continue
                    x1, y1, x2, y2 = xyxy
                    if x2 <= x1 or y2 <= y1:
                        continue
                    items.append({
                        "kind": "player" if class_id == 0 else "ball", "label": label, "track_id": track_id,
                        "confidence": confidence, "bbox_xyxy": xyxy,
                        "bbox_normalized": [round(x1/width,5), round(y1/height,5), round(x2/width,5), round(y2/height,5)],
                        "certainty": "tracked" if track_id is not None else "detection_only",
                        "uncertain": confidence < 0.55 or (class_id == 32 and confidence < 0.65),
                    })
            with _lock:
                _state.update(status="stopping" if _stop.is_set() else "running", frame_width=width, frame_height=height,
                    frame_sequence=sequence, frame_timestamp_seconds=round(timestamp,3),
                    timestamp_kind="source_video_position_estimate", detections=items,
                    updated_at=datetime.now(timezone.utc).isoformat(), error=None,
                    note="Bounding boxes are model estimates. Frame timestamp comes from FFmpeg showinfo source PTS.")
    except Exception as exc:
        with _lock:
            _state.update(status="error", error=str(exc), detections=[], note="Tracking stopped. Check the error and source.")
    finally:
        if process is not None:
            try:
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
            except Exception:
                pass
        with _lock:
            if _process is process:
                _process = None
            if _stop.is_set() and _state.get("status") != "error":
                _state.update(status="stopped", note="Tracking has stopped.")

@router.post("/start")
def start_tracking(body: StartBody):
    global _worker, _stop, _state
    source, source_type = _resolve_source(body.source_url)
    with _lock:
        if _worker is not None and _worker.is_alive():
            raise HTTPException(status_code=409, detail="A tracking worker is already active. Stop it before starting another source.")
        _stop = threading.Event()
        _state = {"session_id":uuid.uuid4().hex,"status":"connecting","source_url":source,"source_type":source_type,
            "started_at":datetime.now(timezone.utc).isoformat(),"error":None,"frame_width":None,"frame_height":None,
            "fps_estimate":None,"frame_timestamp_seconds":None,"timestamp_kind":None,"frame_sequence":0,"detections":[],
            "model":os.getenv("FIRESIGHT_YOLO_MODEL","yolo11n.pt"),"confidence_threshold":body.confidence_threshold,
            "inference_fps":body.inference_fps,"updated_at":None,"note":"Starting FFmpeg decoding and YOLO model initialization."}
        _worker = threading.Thread(target=_tracking_loop,args=(source,source_type,body.confidence_threshold,body.inference_fps),daemon=True)
        _worker.start()
        return {"status":"connecting","session_id":_state["session_id"],"source_type":source_type,"message":"Worker started. Poll /status for decoding and detections."}

@router.post("/stop")
def stop_tracking():
    with _lock:
        if _worker is None or not _worker.is_alive():
            return {"status":_state.get("status","idle")}
        _stop.set()
        process = _process
        _state.update(status="stopping",note="Stopping the tracking worker.")
    if process is not None and process.poll() is None:
        try: process.terminate()
        except OSError: pass
    return {"status":"stopping"}

@router.get("/status")
def tracking_status():
    with _lock:
        return dict(_state)

@router.get("/detections")
def current_detections():
    with _lock:
        return {"status":_state.get("status"),"frame_timestamp_seconds":_state.get("frame_timestamp_seconds"),
            "timestamp_kind":_state.get("timestamp_kind"),"frame_sequence":_state.get("frame_sequence"),
            "frame_width":_state.get("frame_width"),"frame_height":_state.get("frame_height"),
            "detections":list(_state.get("detections",[])),"updated_at":_state.get("updated_at"),
            "note":_state.get("note"),"error":_state.get("error")}
