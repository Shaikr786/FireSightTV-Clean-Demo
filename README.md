# FireSightTV

FireSightTV is a React Native football-video review app backed by a FastAPI service. The service analyzes an authorized video file or stream with FFmpeg and YOLO, then exposes current person and sports-ball detections. The app shows observations and heuristic activity cues for a viewer to review.

This is a computer-vision prototype, not an automated referee or verified highlight generator. It does not identify named players, teams, goals, shots, saves, fouls, or official match time. A detected `sports ball` is only a candidate ball. Track IDs and confidence values are model output, not verified identity or calibrated probability.

## Project layout

- `backend/app/main.py` — FastAPI application and video playback endpoint.
- `backend/app/realtime.py` — FFmpeg decoding, YOLO tracking, and live API routes.
- `backend/data/` — local demo media and SQLite files.
- `backend/requirements.txt` — base API dependencies.
- `backend/requirements-vision.txt` — OpenCV and Ultralytics dependencies.
- `mobile/src/api/client.ts` — typed API client and configurable backend address.
- `mobile/src/screens/MatchScreen.tsx` — Overview, Moments, and Analysis screens.
- `mobile/android/` — Android/Android TV project configuration.
- `REALTIME_IMPLEMENTATION.md` — setup, run, test, and limitation details.

## Run on Windows

Prerequisites: Windows 10/11, Python 3.10+, Node.js 20, Java 17, Android Studio/SDK, and FFmpeg available on `PATH` (or configured through `FIRESIGHT_FFMPEG_PATH`). The model weights are not stored in the repository; Ultralytics downloads `yolo11n.pt` on first analysis if it is not already present.

1. From the project root, run `.\run-backend.ps1` once to create the Python environment and install base API dependencies. Stop the server with Ctrl+C after setup.
2. Install vision dependencies:

   ```powershell
   Set-Location .\backend
   .\.venv\Scripts\python.exe -m pip install -r requirements-vision.txt
   ```

3. Start the API from the project root:

   ```powershell
   .\run-backend.ps1
   ```

   The API listens on port 8000 and is bound to `0.0.0.0` for a local device demo.

4. In another terminal, start Metro:

   ```powershell
   Set-Location .\mobile
   npm install
   npm start
   ```

   In a separate terminal, build/run Android:

   ```powershell
   Set-Location .\mobile
   npm run android
   ```

5. In the app, open **Analysis** and set **Backend address**:
   - Android emulator / Android TV emulator: `http://10.0.2.2:8000`
   - Physical Fire TV on the same network: `http://<backend-computer-LAN-IP>:8000`

   Tap **Connect backend**. The default video source is `data\videos\f8d51dc8dc444ae4a2e18f1c283f73d9.webm`, relative to the backend working directory. You can enter another existing video path on the backend computer or an authorized reachable stream URL.

6. Verify the service and workflow:
   - Open `http://127.0.0.1:8000/health` on the backend computer; it should report `seeded: false`.
   - Open `http://127.0.0.1:8000/docs` for the interactive API documentation.
   - Run `.\smoke-test.ps1` from the project root.
   - In the app, start analysis and check that frames and observations update.

The debug Android variant permits HTTP for local-network demos; the main/release configuration disallows cleartext HTTP. Use HTTPS for release builds or deployment beyond a controlled local demo network. The current API has no authentication; do not expose it to the public internet.

## API

- `GET /health`
- `POST /api/v1/live/start` — JSON: `{"source_url":"data\\videos\\f8d51dc8dc444ae4a2e18f1c283f73d9.webm","confidence_threshold":0.25,"inference_fps":4}`
- `GET /api/v1/live/status`
- `GET /api/v1/live/detections`
- `POST /api/v1/live/stop`
- `GET /api/v1/live/video` — serves the included local demo video.
- `GET /docs`

The worker supports local video paths and RTSP/RTSPS/HTTP(S) sources accessible to the backend computer. Native RTSP playback is not supported by the current mobile player; use an accessible HTTP(S)/HLS URL for in-app playback. Only use media and streams you are authorized to access.

The default demo uses the 8.9 MB clip under `backend/data/videos/`, which was selected after you confirmed redistribution rights. The optional `backend/data/football-test.webm` is about 651 MB, exceeds GitHub's 100 MB limit for regular files, and is excluded by `.gitignore`; do not remove that exclusion unless you configure Git LFS. For any clip replacement, keep the default analysis path and `/api/v1/live/video` pointed to the same authorized media.

## Hackathon demo checklist

The Amazon Developer Hackathon Fire TV track requires a demo-ready app that runs on Fire OS or Vega OS. The submission video must show it running on an actual Fire TV device or Fire TV/Vega simulator; a regular Android emulator alone does not establish Fire TV compatibility.

- Test installation, remote navigation, video playback, backend connectivity, and analysis on the target Fire TV device/simulator.
- Record a public YouTube or Vimeo demo under three minutes, showing the app working on the target platform.
- Provide a GitHub repository with required source, assets, license (if public), and clear setup/run instructions.
- Include a project description, product feedback for developer tools used, and select the Fire TV track on Devpost.
- Explain substantial hackathon-period updates if the project predates the submission period.
- Do not claim the AWS Builder or Open Source mini-challenge without meeting its separate criteria.

See the [official hackathon rules](https://amazonappdev2026.devpost.com/rules) for current requirements and dates. The application and its build configuration do not substitute for device/simulator validation or a completed Devpost submission.

## Checks

From `mobile/`:

```powershell
npx tsc --noEmit
npm test -- --runInBand
npm run lint
```

From the project root, with the backend dependencies installed:

```powershell
.\smoke-test.ps1
```
