import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import { api, Detection, TrackingStatus } from '../api/client';

const DEFAULT_SOURCE =
  'data\\videos\\f8d51dc8dc444ae4a2e18f1c283f73d9.webm';

// Restrained broadcast palette: ink, slate, ivory and one teal accent.
const C = {
  bg: '#080D14',
  surface: '#101923',
  surfaceRaised: '#17232F',
  divider: '#293744',
  text: '#F1F5F8',
  muted: '#A2AFBA',
  accent: '#55D6BE',
  blue: '#83C8F2',
  warning: '#E8B76A',
  danger: '#EF8585',
};
type Tab = 'overview' | 'moments' | 'analysis';
type Moment = { id: string; time: number; title: string; detail: string; kind: 'ball' | 'activity' };

const formatTime = (seconds?: number | null) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '—';
  }
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};
const readable = (value?: string | null) => (value || 'Unknown').replace(/_/g, ' ');

export function MatchScreen() {
  const videoRef = useRef<VideoRef>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [apiBaseUrlDraft, setApiBaseUrlDraft] = useState(api.getBaseUrl());
  const [apiBaseUrl, setApiBaseUrl] = useState(api.getBaseUrl());
  const [status, setStatus] = useState<TrackingStatus | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [apiError, setApiError] = useState('');
  const [apiHealthy, setApiHealthy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [videoError, setVideoError] = useState('');
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [moments, setMoments] = useState<Moment[]>([]);
  const previousBallRef = useRef(false);
  const previousCountRef = useRef(0);
  const previousMomentKeyRef = useRef('');
  const SHOW_BOUNDING_BOXES = false;

  const refresh = useCallback(async () => {
    try {
      const [health, live, current] = await Promise.all([
        api.health(), api.liveStatus(), api.detections(),
      ]);
      setApiHealthy(health.status === 'ok');
      setStatus(live);
      const next = current.detections || [];
      setDetections(next);
      setApiError(current.error || live.error || '');
      // Generate review candidates only from real changes in model output.
      // These are activity markers, not verified goals/shots/highlights.
      const timestamp = current.frame_timestamp_seconds ?? live.frame_timestamp_seconds;
      if (typeof timestamp === 'number' && live.status === 'running') {
        const hasBall = next.some(d => d.kind.toLowerCase().includes('ball'));
        const people = next.filter(d => {
          const k = d.kind.toLowerCase();
          return k.includes('person') || k.includes('player');
        }).length;
        const key = `${Math.floor(timestamp / 5)}-${hasBall ? 'ball' : 'no-ball'}-${Math.floor(people / 3)}`;
        const ballAppeared = hasBall && !previousBallRef.current;
        const crowdChanged = Math.abs(people - previousCountRef.current) >= 4;
        if ((ballAppeared || crowdChanged) && previousMomentKeyRef.current !== key) {
          const item: Moment = {
            id: `${timestamp}-${key}`,
            time: timestamp,
            title: ballAppeared ? 'Ball detected' : 'Player activity changed',
            detail: ballAppeared
              ? 'The vision model detected the ball in this frame. Review the footage to assess the play.'
              : `${people} people detected in the current frame. This is an activity cue, not a confirmed match event.`,
            kind: ballAppeared ? 'ball' : 'activity',
          };
          setMoments(existing => [item, ...existing].slice(0, 40));
          previousMomentKeyRef.current = key;
        }
        previousBallRef.current = hasBall;
        previousCountRef.current = people;
      }
    } catch (e) {
      setApiHealthy(false);
      setApiError(e instanceof Error ? e.message : 'Unable to contact the FireSight API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = useCallback(async () => {
    if (!source.trim()) {
      setApiError('Enter a backend video path or accessible stream URL.');
      return;
    }
    setBusy(true);
    setApiError('');
    try {
      await api.startTracking(source.trim());
      previousBallRef.current = false;
      previousCountRef.current = 0;
      previousMomentKeyRef.current = '';
      setMoments([]);
      await refresh();
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Could not start analysis.');
    } finally { setBusy(false); }
  }, [source, refresh]);

  const connectBackend = useCallback(async () => {
    setBusy(true);
    setApiError('');
    try {
      const configuredUrl = api.setBaseUrl(apiBaseUrlDraft);
      setApiBaseUrl(configuredUrl);
      setVideoError('');
      await refresh();
    } catch (e) {
      setApiHealthy(false);
      setApiError(e instanceof Error ? e.message : 'Could not configure the backend address.');
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrlDraft, refresh]);

  const stop = useCallback(async () => {
    setBusy(true);
    setApiError('');
    try { await api.stopTracking(); await refresh(); }
    catch (e) { setApiError(e instanceof Error ? e.message : 'Could not stop analysis.'); }
    finally { setBusy(false); }
  }, [refresh]);

  const trackingStatus = status?.status || 'idle';
  const active = ['running', 'connecting', 'stopping'].includes(trackingStatus);
  const people = useMemo(() => detections.filter(d => {
    const k = d.kind.toLowerCase();
    return k.includes('person') || k.includes('player');
  }).length, [detections]);
  const ball = detections.some(d => d.kind.toLowerCase().includes('ball'));

  const jumpTo = (time: number) => {
    if (!videoRef.current || videoDuration <= 0 || !Number.isFinite(time)) {
      return;
    }

    const target = Math.max(0, Math.min(videoDuration, time));
    pendingSeekRef.current = target;
    setVideoPaused(true);
    videoRef.current.seek(target);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>F</Text></View>
            <View>
              <Text style={styles.brandTitle}>FIRESIGHT <Text style={styles.brandAccent}>TV</Text></Text>
              <Text style={styles.brandSub}>FOOTBALL INTELLIGENCE</Text>
            </View>
          </View>
          <View style={styles.statusWrap}>
            <View style={[styles.statusDot, { backgroundColor: trackingStatus === 'running' ? C.accent : trackingStatus === 'error' ? C.danger : C.muted }]} />
            <Text style={styles.statusText}>{trackingStatus === 'running' ? 'ANALYZING' : readable(trackingStatus).toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.connectionRow}>
          <View style={[styles.statusDot, { backgroundColor: apiHealthy ? C.accent : C.danger }]} />
          <Text style={styles.connectionText}>{apiHealthy ? 'INTELLIGENCE CONNECTED' : 'API UNAVAILABLE'}</Text>
          <Text style={styles.connectionDivider}>/</Text>
          <Text style={styles.connectionText}>RECORDED FOOTAGE</Text>
        </View>

        <View style={styles.videoShell}>
          {videoError ? (
            <View style={styles.videoFallback}>
              <Text style={styles.fallbackTitle}>Video unavailable</Text>
              <Text style={styles.muted}>{videoError}</Text>
            </View>
          ) : (
            <>
              <Video
                ref={videoRef}
                source={{ uri: api.videoUrl(apiBaseUrl) }}
                style={styles.video}
                resizeMode="contain"
                controls
                paused={videoPaused}
                repeat={false}
                onLoad={data => { setVideoDuration(data.duration || 0); setVideoError(''); }}
                onProgress={data => {
                  const currentTime = data.currentTime || 0;
                  setVideoTime(currentTime);
                }}
                onSeek={data => {
                  const actualTime = data.currentTime || 0;
                  setVideoTime(actualTime);

                  const target = pendingSeekRef.current;
                  if (target !== null) {
                    pendingSeekRef.current = null;
                    if (Math.abs(actualTime - target) <= 2) {
                      setVideoPaused(false);
                    } else {
                      console.warn('[FireSight] Seek did not reach target', { target, actualTime });
                      setVideoPaused(false);
                    }
                  }
                }}
                onError={e => setVideoError(e.error?.errorString || 'Playback failed. Check the backend video endpoint.')}
              />
{SHOW_BOUNDING_BOXES && active && status?.frame_width && status?.frame_height && detections.map((d, i) => {                const b = d.bbox_normalized;
                if (!b || b.length < 4) {
                  return null;
                }
                const [x1, y1, x2, y2] = b;
                const left = Math.max(0, Math.min(100, x1 * 100));
                const top = Math.max(0, Math.min(100, y1 * 100));
                const width = Math.max(1, Math.min(100 - left, (x2 - x1) * 100));
                const height = Math.max(1, Math.min(100 - top, (y2 - y1) * 100));
                return (
                  <View key={`${d.track_id ?? d.kind}-${i}`} pointerEvents="none"
                    style={[styles.boxOverlay, { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, borderColor: d.kind.toLowerCase().includes('ball') ? C.warning : C.accent }]}>
                    <Text style={[styles.boxLabel, { backgroundColor: d.kind.toLowerCase().includes('ball') ? C.warning : C.accent }]}>
                      {d.kind.toLowerCase().includes('ball') ? 'BALL' : `#${d.track_id ?? 'PLAYER'}`}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </View>

        <View style={styles.videoMeta}>
          <View style={styles.videoTitleWrap}>
            <Text style={styles.videoTitle}>Football footage</Text>
            <Text style={styles.muted}>Recorded clip · analysis runs independently of playback</Text>
          </View>
          <Text style={styles.timeText}>{formatTime(videoTime)}{videoDuration > 0 ? ` / ${formatTime(videoDuration)}` : ''}</Text>
        </View>

        <View style={styles.tabs}>
          <TabButton label="OVERVIEW" selected={tab === 'overview'} onPress={() => setTab('overview')} />
          <TabButton label={`MOMENTS${moments.length ? `  ${moments.length}` : ''}`} selected={tab === 'moments'} onPress={() => setTab('moments')} />
          <TabButton label="ANALYSIS" selected={tab === 'analysis'} onPress={() => setTab('analysis')} />
        </View>

        {tab === 'overview' && (
          <View style={styles.content}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.eyebrow}>MATCH CENTRE</Text>
                <Text style={styles.heading}>What we're seeing</Text>
              </View>
              <Text style={styles.liveTime}>{formatTime(status?.frame_timestamp_seconds)}</Text>
            </View>
            <Text style={styles.sectionIntro}>Computer-vision observations from the most recently analyzed frame.</Text>
            <View style={styles.summaryRow}>
              <Summary label="PEOPLE TRACKED" value={String(people)} />
              <View style={styles.summaryDivider} />
              <Summary label="BALL" value={ball ? 'Detected' : 'Not in frame'} />
              <View style={styles.summaryDivider} />
              <Summary label="ANALYSIS" value={active ? 'Running' : 'Stopped'} />
            </View>
            <View style={styles.sectionRule} />
            <View style={styles.sectionHeading}>
              <Text style={styles.subheading}>Latest observations</Text>
              <Text style={styles.muted}>{detections.length} objects</Text>
            </View>
            {detections.length === 0 ? (
              <EmptyState title={active ? 'Waiting for detections' : 'Ready when you are'} body={active ? 'The model has not returned objects for the latest frame yet.' : 'Open Analysis and start processing the recorded clip.'} />
            ) : detections.slice(0, 5).map((d, i) => <Observation key={`${d.kind}-${d.track_id ?? i}`} detection={d} />)}
            <Text style={styles.disclaimer}>Track IDs are temporary. These observations do not independently confirm a goal, shot, foul or save.</Text>
            <Pressable accessibilityRole="button" onPress={() => setTab('moments')} style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}>
              <Text style={styles.textLinkText}>Review detected moments  →</Text>
            </Pressable>
          </View>
        )}

        {tab === 'moments' && (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>TIMESTAMPED ACTIVITY</Text>
            <Text style={styles.heading}>Moments to review</Text>
            <Text style={styles.sectionIntro}>These are automatically collected review cues from model output, not confirmed football highlights. Use the timestamp to inspect the actual footage.</Text>
            {moments.length === 0 ? (
              <EmptyState title="No activity cues collected yet" body="Start analysis. When the model reports a new ball detection or a significant change in people detected, a review marker can appear here." />
            ) : moments.map(m => (
              <MomentRow key={m.id} moment={m} onPress={() => jumpTo(m.time)} />
            ))}
            <Text style={styles.disclaimer}>True event highlights—goals, shots, saves and fouls—require a validated event-recognition pipeline. These markers are a first step, not a substitute.</Text>
          </View>
        )}

        {tab === 'analysis' && (
          <View style={styles.content}>
            <Text style={styles.eyebrow}>SYSTEM CONTROLS</Text>
            <Text style={styles.heading}>Video analysis</Text>
            <Text style={styles.sectionIntro}>Choose a source on the backend computer and run the vision model. Playback and analysis are separate processes.</Text>
            <Text style={styles.fieldLabel}>BACKEND ADDRESS</Text>
            <TextInput
              value={apiBaseUrlDraft}
              onChangeText={setApiBaseUrlDraft}
              style={styles.input}
              placeholder="http://192.168.1.20:8000"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Backend API address"
              editable={!busy}
            />
            <Text style={styles.muted}>Android emulator: 10.0.2.2. Fire TV device: use the backend computer's LAN IP.</Text>
            <View style={styles.actionRow}>
              <ActionButton label={busy ? 'PLEASE WAIT…' : 'Connect backend'} primary disabled={busy} onPress={() => connectBackend()} />
            </View>
            <Text style={styles.fieldLabel}>VIDEO SOURCE</Text>
            <TextInput value={source} onChangeText={setSource} style={styles.input} placeholder="Backend video path or stream URL" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} editable={!busy && !active} />
            <View style={styles.actionRow}>
              <ActionButton label={busy ? 'PLEASE WAIT…' : 'Start analysis'} primary disabled={busy || active} onPress={() => start()} />
              <ActionButton label={busy ? 'PLEASE WAIT…' : 'Stop analysis'} disabled={busy || !active} onPress={() => stop()} />
              <ActionButton label="Refresh" disabled={busy} onPress={() => refresh()} />
            </View>
            {loading && <View style={styles.inlineRow}><ActivityIndicator color={C.accent} /><Text style={styles.muted}>Connecting…</Text></View>}
            {!!apiError && <View style={styles.errorLine}><Text style={styles.errorTitle}>SYSTEM MESSAGE</Text><Text style={styles.errorText}>{apiError}</Text></View>}
            <View style={styles.systemStats}>
              <Stat label="Frames analyzed" value={String(status?.frame_sequence ?? 0)} />
              <Stat label="Current detections" value={String(detections.length)} />
              <Stat label="Inference rate" value={status?.fps_estimate != null ? `${status.fps_estimate} FPS` : '—'} />
              <Stat label="Source type" value={readable(status?.source_type)} />
              <Stat label="Model" value={status?.model || '—'} />
              <Stat label="Session" value={status?.session_id ? `${status.session_id.slice(0, 12)}…` : '—'} />
            </View>
          </View>
        )}

        <Text style={styles.footer}>FIRESIGHT TV  ·  OBSERVATIONS FROM THE MODEL  ·  NO INVENTED EVENTS</Text>
      </ScrollView>
    </View>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.tab, selected && styles.tabSelected, focused && styles.focused, pressed && styles.pressed]}><Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text></Pressable>;
}
function ActionButton({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.actionButton, primary && styles.actionPrimary, focused && styles.focused, pressed && styles.pressed, disabled && styles.disabled]}><Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{label}</Text></Pressable>;
}
function Summary({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.statRow}><Text style={styles.muted}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return <View style={styles.emptyState}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></View>;
}
function Observation({ detection }: { detection: Detection }) {
  return <View style={styles.observation}><View style={styles.observationMark} /><View style={styles.observationCopy}><Text style={styles.observationTitle}>{readable(detection.kind)}{detection.track_id != null ? `  #${detection.track_id}` : ''}</Text><Text style={styles.muted}>{detection.uncertain ? 'Lower confidence' : readable(detection.certainty)}</Text></View><Text style={styles.confidence}>{Math.round(detection.confidence * 100)}%</Text></View>;
}
function MomentRow({ moment, onPress }: { moment: Moment; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.momentRow, focused && styles.focused, pressed && styles.pressed]}>
    <View style={styles.momentTime}><Text style={styles.momentTimeText}>{formatTime(moment.time)}</Text></View>
    <View style={styles.momentCopy}><Text style={styles.momentTitle}>{moment.title}</Text><Text style={styles.muted}>{moment.detail}</Text></View>
    <Text style={styles.playGlyph}>▶</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  page: { paddingHorizontal: 26, paddingTop: 20, paddingBottom: 30, gap: 17 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: C.divider },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 42, height: 42, borderRadius: 9, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: C.bg, fontSize: 25, fontWeight: '900' },
  brandTitle: { color: C.text, fontSize: 21, fontWeight: '800', letterSpacing: 1.1 },
  brandAccent: { color: C.accent },
  brandSub: { color: C.muted, fontSize: 9, letterSpacing: 1.8, marginTop: 4 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  connectionText: { color: C.muted, fontSize: 10, letterSpacing: 0.6 },
  connectionDivider: { color: C.divider, fontSize: 13 },
  muted: { color: C.muted, fontSize: 12, lineHeight: 18 },
  videoShell: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 5, overflow: 'hidden', justifyContent: 'center', position: 'relative' },
  video: { width: '100%', height: '100%' },
  videoFallback: { padding: 24, gap: 8 },
  fallbackTitle: { color: C.danger, fontSize: 16, fontWeight: '700' },
  boxOverlay: { position: 'absolute', borderWidth: 2 },
  boxLabel: { alignSelf: 'flex-start', color: C.bg, fontSize: 9, fontWeight: '900', paddingHorizontal: 4, paddingVertical: 2, overflow: 'hidden' },
  videoMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  videoTitleWrap: { flex: 1, gap: 3 },
  videoTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  timeText: { color: C.blue, fontSize: 13, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 24, borderBottomWidth: 1, borderBottomColor: C.divider, paddingBottom: 0 },
  tab: { paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabSelected: { borderBottomColor: C.accent },
  tabText: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  tabTextSelected: { color: C.text },
  focused: { borderColor: C.blue, borderWidth: 2, borderRadius: 5 },
  pressed: { opacity: 0.78 },
  content: { paddingTop: 5, paddingBottom: 4, gap: 15 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, marginBottom: 5 },
  heading: { color: C.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  liveTime: { color: C.blue, fontSize: 13, fontWeight: '700' },
  sectionIntro: { color: C.muted, fontSize: 13, lineHeight: 20, maxWidth: 850 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 22 },
  summaryItem: { flex: 1, gap: 6 },
  summaryLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  summaryValue: { color: C.text, fontSize: 18, fontWeight: '700' },
  summaryDivider: { width: 1, height: 38, backgroundColor: C.divider },
  sectionRule: { height: 1, backgroundColor: C.divider, marginVertical: 2 },
  subheading: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptyState: { borderLeftWidth: 2, borderLeftColor: C.divider, paddingVertical: 8, paddingLeft: 15, gap: 6 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  observation: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.divider },
  observationMark: { width: 5, height: 28, backgroundColor: C.accent, borderRadius: 2 },
  observationCopy: { flex: 1, gap: 3 },
  observationTitle: { color: C.text, fontSize: 13, fontWeight: '700' },
  confidence: { color: C.accent, fontSize: 13, fontWeight: '700' },
  disclaimer: { color: C.warning, fontSize: 11, lineHeight: 17 },
  textLink: { alignSelf: 'flex-start', paddingVertical: 8 },
  textLinkText: { color: C.accent, fontSize: 12, fontWeight: '700' },
  momentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.divider },
  momentTime: { minWidth: 52, paddingTop: 2 },
  momentTimeText: { color: C.blue, fontSize: 12, fontWeight: '800' },
  momentCopy: { flex: 1, gap: 5 },
  momentTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  playGlyph: { color: C.accent, fontSize: 14, paddingHorizontal: 5, paddingTop: 2 },
  fieldLabel: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 5 },
  input: { minHeight: 48, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.divider, color: C.text, paddingHorizontal: 12, fontSize: 13 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 3 },
  actionButton: { minHeight: 42, paddingHorizontal: 17, borderRadius: 4, borderWidth: 1, borderColor: C.divider, backgroundColor: C.surfaceRaised, justifyContent: 'center', alignItems: 'center' },
  actionPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  actionText: { color: C.text, fontSize: 11, fontWeight: '800' },
  actionPrimaryText: { color: C.bg },
  disabled: { opacity: 0.42 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorLine: { borderLeftWidth: 2, borderLeftColor: C.danger, paddingLeft: 12, paddingVertical: 8, gap: 5 },
  errorTitle: { color: C.danger, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  errorText: { color: '#F0C5C5', fontSize: 12, lineHeight: 18 },
  systemStats: { marginTop: 5, borderTopWidth: 1, borderTopColor: C.divider },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 15, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider },
  statValue: { color: C.text, fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  footer: { color: '#657583', textAlign: 'center', fontSize: 9, marginTop: 4, letterSpacing: 0.8 },
});
