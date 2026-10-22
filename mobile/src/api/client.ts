const DEFAULT_BASE_URL = 'http://10.0.2.2:8000';
let baseUrl = DEFAULT_BASE_URL;

export function normalizeApiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid backend URL, for example http://192.168.1.20:8000.');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Backend URL must use HTTP or HTTPS and must not include credentials, a query, or a fragment.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

export type Detection = {
  kind: string;
  label: string;
  track_id: number | null;
  confidence: number;
  bbox_xyxy: number[];
  bbox_normalized: number[];
  certainty: string;
  uncertain: boolean;
};

export type TrackingStatus = {
  session_id?: string;
  status: string;
  source_url?: string | null;
  source_type?: string | null;
  started_at?: string | null;
  error?: string | null;
  frame_width?: number | null;
  frame_height?: number | null;
  fps_estimate?: number | null;
  frame_timestamp_seconds?: number | null;
  timestamp_kind?: string | null;
  frame_sequence?: number;
  detections?: Detection[];
  model?: string;
  confidence_threshold?: number;
  inference_fps?: number;
  updated_at?: string | null;
  note?: string;
};

export type DetectionResponse = {
  status: string;
  frame_timestamp_seconds?: number | null;
  timestamp_kind?: string | null;
  frame_sequence?: number;
  frame_width?: number | null;
  frame_height?: number | null;
  detections: Detection[];
  updated_at?: string | null;
  note?: string;
  error?: string | null;
};

async function request<T>(
  path: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error(
      'Cannot reach FireSight API. Check the backend address, ensure the server is running, and confirm the device can reach it.',
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getBaseUrl: () => baseUrl,

  setBaseUrl: (value: string) => {
    baseUrl = normalizeApiBaseUrl(value);
    return baseUrl;
  },

  videoUrl: (apiBaseUrl = baseUrl) =>
    `${normalizeApiBaseUrl(apiBaseUrl)}/api/v1/live/video`,

  health: () =>
    request<{
      status: string;
      service?: string;
      database?: string;
      seeded?: boolean;
      tracking?: string;
    }>('/health'),

  liveStatus: () =>
    request<TrackingStatus>('/api/v1/live/status'),

  detections: () =>
    request<DetectionResponse>('/api/v1/live/detections'),

  startTracking: (
    sourceUrl: string,
    confidenceThreshold = 0.25,
    inferenceFps = 4,
  ) =>
    request<TrackingStatus>('/api/v1/live/start', {
      method: 'POST',
      body: JSON.stringify({
        source_url: sourceUrl,
        confidence_threshold: confidenceThreshold,
        inference_fps: inferenceFps,
      }),
    }),

  stopTracking: () =>
    request<{ status: string }>('/api/v1/live/stop', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
