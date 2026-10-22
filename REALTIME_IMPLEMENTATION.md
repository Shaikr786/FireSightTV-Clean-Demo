# FireSightTV real-time tracking

The current application analyzes a selected local video or accessible stream on the backend computer and presents the latest model observations in the React Native app. This is an evidence-first computer-vision prototype. It does not infer verified football events or athlete identity.

## Current behavior

- `POST /api/v1/live/start` accepts an existing local video path or RTSP/RTSPS/HTTP(S) URL.
- FFmpeg decodes and samples frames; Ultralytics YOLO tracks COCO `person` and `sports ball` classes.
- `GET /api/v1/live/status` and `GET /api/v1/live/detections` return worker state, latest observations, dimensions, and source-position timestamp metadata.
- `POST /api/v1/live/stop` requests worker shutdown.
- The app polls for new output and creates heuristic review cues when ball presence or the number of detected people changes.
- `/api/v1/live/video` serves the 8.9 MB included demo clip. The Analysis screen defaults to the same clip so timestamp cues can be reviewed in the player. Selecting another analysis source does not change the player clip.

## Setup and run

Follow the Windows instructions in [README.md](README.md). The backend needs the base requirements plus `requirements-vision.txt`, and FFmpeg must be installed or provided through `FIRESIGHT_FFMPEG_PATH`. The Analysis screen can change the backend address without rebuilding:

- Emulator: `http://10.0.2.2:8000`
- Physical Fire TV on the same LAN: `http://<backend-computer-LAN-IP>:8000`

Run the backend bound to the network interface (`--host 0.0.0.0`) only on a controlled, trusted demo network. The current API has no authentication and must not be exposed to the public internet. The Android debug variant permits HTTP for local testing; release configuration requires HTTPS.

## Timestamp and uncertainty

Timestamps come from FFmpeg `showinfo` presentation timestamps. If the worker cannot pair an analyzed frame with a source PTS, it stops with an error rather than substituting elapsed wall-clock time. Timestamp precision and meaning still depend on the source stream. Frame sequence is a processing sequence, not a guaranteed original source-frame index.

`person` is a temporary person track, not a named player. `sports ball` is a generic model class and may be a different object. Confidence is model output and not a calibrated probability. IDs can change after occlusion, camera movement, or cuts.

## Limitations

- No named athlete, jersey number, team, possession, score, goal, shot, save, foul, or official match-clock recognition.
- Moment cues are heuristics from current detection changes, not confirmed highlights or an archival event database.
- Analysis and playback are independent. The default analysis path uses the included clip, but selecting a different source does not change the player clip.
- Native RTSP playback is not supported. RTSP can be analyzed if FFmpeg can access it, but use an accessible HTTP(S)/HLS URL for in-app playback.
- Detection overlays are not enabled in the current UI. Stable video-to-analysis synchronization and content-rectangle mapping are needed before treating overlays as aligned.
- CPU works but can be slow. `inference_fps` is configurable (0.5–15); the default is 4.
- The API accepts arbitrary local paths and network URLs because the demo needs operator-selected sources. Run it only in a trusted local environment.

## API quick check

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/live/status
```

The health response reports `seeded: false`. Use `http://127.0.0.1:8000/docs` to try the tracking routes.
