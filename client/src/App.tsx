import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from "react";
import { fetchBootstrap, reflectLesson } from "./lib/api";
import { useRealtimeTutorSession } from "./hooks/useRealtimeTutorSession";
import type {
  AudioInputDevice,
  BootstrapPayload,
  CultureScene,
  LessonReflection,
  SessionPreset,
  TutorProfile
} from "./types";

const statusCopy: Record<string, string> = {
  idle: "Ready when you are.",
  connecting: "Connecting your voice studio.",
  ready: "Tutor is listening for the next turn.",
  listening: "Your microphone is live.",
  speaking: "Tutor is speaking now.",
  error: "Session needs attention."
};

function formatRelativeDate(dateIso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(dateIso));
}

const audioDeviceStorageKey = "parola-viva.audio-input";

function toAudioInputDevices(devices: MediaDeviceInfo[]): AudioInputDevice[] {
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      isDefault: index === 0,
      label: device.label || (index === 0 ? "Default microphone" : `Microphone ${index + 1}`)
    }));
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [profile, setProfile] = useState<TutorProfile | null>(null);
  const [activePreset, setActivePreset] = useState<SessionPreset | null>(null);
  const [reflection, setReflection] = useState<LessonReflection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState("");

  const {
    endSession,
    eventLog,
    error: sessionError,
    liveTutorCaption,
    liveUserCaption,
    micLevel,
    startSession,
    status,
    transcript
  } = useRealtimeTutorSession();

  const deferredTranscript = useDeferredValue(transcript);
  const isSessionLive =
    status === "ready" || status === "listening" || status === "speaking";

  useEffect(() => {
    fetchBootstrap()
      .then((payload) => {
        setBootstrap(payload);
        setProfile(payload.profile);
        setActivePreset(payload.sessionPresets[0] ?? null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load the app.");
      });
  }, []);

  useEffect(() => {
    const savedInputId = window.localStorage.getItem(audioDeviceStorageKey);
    if (savedInputId) {
      setSelectedAudioInputId(savedInputId);
    }
  }, []);

  useEffect(() => {
    async function loadAudioInputs() {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = toAudioInputDevices(devices);
      setAudioInputs(inputs);

      setSelectedAudioInputId((current) => {
        if (current && inputs.some((device) => device.deviceId === current)) {
          return current;
        }
        return inputs[0]?.deviceId ?? "";
      });
    }

    void loadAudioInputs();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadAudioInputs);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadAudioInputs);
    };
  }, []);

  useEffect(() => {
    if (!selectedAudioInputId) {
      return;
    }
    window.localStorage.setItem(audioDeviceStorageKey, selectedAudioInputId);
  }, [selectedAudioInputId]);

  const heroScenes = useMemo<CultureScene[]>(
    () => bootstrap?.cultureScenes ?? [],
    [bootstrap?.cultureScenes]
  );

  async function handleStart() {
    if (!activePreset) {
      return;
    }

    setReflection(null);
    await startSession({
      deviceId: selectedAudioInputId || undefined,
      focus: activePreset.focus,
      presetLabel: activePreset.label
    });

    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(toAudioInputDevices(devices));
    }
  }

  async function handleEnd() {
    if (!activePreset) {
      return;
    }

    const capture = await endSession();
    if (!capture || capture.turns.length === 0) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = await reflectLesson({
        focus: activePreset.focus,
        presetLabel: activePreset.label,
        capture
      });

      startTransition(() => {
        setReflection(payload.reflection);
        setProfile(payload.profile);
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "We could not save this lesson yet."
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (loadError && !bootstrap) {
    return (
      <main className="app-shell">
        <section className="error-state">
          <p>Parola Viva could not load.</p>
          <strong>{loadError}</strong>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Parola Viva</span>
          <h1>Italian speaking sessions that feel like a real tutor, not a worksheet.</h1>
          <p className="lede">
            Low-latency voice practice, living lesson memory, and a contemporary Italy mood
            that leans more Milan studio, seaside train, and evening aperitivo than
            tired postcard cliches.
          </p>

          <div className="hero-meta">
            <div>
              <small>Realtime voice</small>
              <strong>{bootstrap?.app.voice ?? "marin"}</strong>
            </div>
            <div>
              <small>Current focus</small>
              <strong>{profile?.nextSessionFocus ?? "Conversation confidence"}</strong>
            </div>
            <div>
              <small>Your level</small>
              <strong>{profile?.levelEstimate ?? "Beginning"}</strong>
            </div>
          </div>

          <div className="preset-strip" aria-label="Lesson presets">
            {bootstrap?.sessionPresets.map((preset) => {
              const isActive = preset.id === activePreset?.id;
              return (
                <button
                  key={preset.id}
                  className={isActive ? "preset-chip active" : "preset-chip"}
                  onClick={() => setActivePreset(preset)}
                  type="button"
                >
                  <span>{preset.label}</span>
                  <small>{preset.brief}</small>
                </button>
              );
            })}
          </div>
        </div>

        <section className="studio-panel">
          <div className="studio-header">
            <div>
              <span className="eyebrow">Speaking Studio</span>
              <h2>{activePreset?.title ?? "Pick a session shape"}</h2>
            </div>
            <span className={`status-pill ${status}`}>{statusCopy[status]}</span>
          </div>

          <div className="voice-stage">
            <div className={`voice-orb ${status}`} />
            <p>{activePreset?.focus}</p>
          </div>

          <div className="session-actions">
            <button
              className="primary-action"
              onClick={handleStart}
              type="button"
              disabled={
                !activePreset ||
                status === "connecting" ||
                status === "ready" ||
                status === "listening" ||
                status === "speaking"
              }
            >
              Start speaking
            </button>
            <button
              className="secondary-action"
              onClick={handleEnd}
              type="button"
              disabled={status === "idle" || status === "connecting"}
            >
              End and save lesson
            </button>
          </div>

          <div className="audio-input-panel">
            <label className="audio-input-label" htmlFor="audio-input-select">
              Microphone
            </label>
            <select
              id="audio-input-select"
              className="audio-input-select"
              value={selectedAudioInputId}
              onChange={(event) => setSelectedAudioInputId(event.target.value)}
              disabled={status === "connecting"}
            >
              {audioInputs.length === 0 && <option value="">Default microphone</option>}
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                  {device.isDefault ? " (Default)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="caption-well">
            <div>
              <small>You</small>
              <p>{liveUserCaption || "When you speak, your live transcript appears here."}</p>
            </div>
            <div>
              <small>Tutor</small>
              <p>{liveTutorCaption || "The tutor replies with speech first, then text for support."}</p>
            </div>
          </div>

          <div className="mic-meter">
            <div className="mic-meter-header">
              <small>Mic activity</small>
              <span>{micLevel > 0.09 ? "Hearing you" : "Waiting for speech"}</span>
            </div>
            <div className="mic-meter-track" aria-hidden="true">
              <div
                className="mic-meter-fill"
                style={{ transform: `scaleX(${Math.max(0.04, micLevel)})` }}
              />
            </div>
          </div>

          {(sessionError || loadError) && (
            <div className="inline-error">{sessionError ?? loadError}</div>
          )}

          {eventLog.length > 0 && (
            <div className="caption-well" aria-live="polite">
              <div>
                <small>Connection log</small>
                {eventLog.slice(0, 6).map((item) => (
                  <p key={item.id}>
                    <strong>{item.type}</strong>
                    {item.detail ? `: ${item.detail}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="mobile-dock" aria-label="Mobile speaking controls">
        <div className="mobile-dock-copy">
          <small>{activePreset?.label ?? "Session"}</small>
          <strong>{statusCopy[status]}</strong>
        </div>
        <div className="mobile-dock-actions">
          <button
            className="primary-action"
            onClick={handleStart}
            type="button"
            disabled={!activePreset || status === "connecting" || isSessionLive}
          >
            Start
          </button>
          <button
            className="secondary-action"
            onClick={handleEnd}
            type="button"
            disabled={status === "idle" || status === "connecting"}
          >
            End
          </button>
        </div>
      </section>

      <section className="content-grid">
        <section className="memory-column">
          <div className="section-heading">
            <span className="eyebrow">Lesson Memory</span>
            <h3>Your tutor keeps the thread.</h3>
          </div>

          <div className="memory-rows">
            <div className="memory-row">
              <span>Goals</span>
              <p>{profile?.goals.join(" / ")}</p>
            </div>
            <div className="memory-row">
              <span>Correction style</span>
              <p>{profile?.correctionPriorities.join(" / ")}</p>
            </div>
            <div className="memory-row">
              <span>Preferred topics</span>
              <p>{profile?.preferredTopics.join(" / ")}</p>
            </div>
            <div className="memory-row">
              <span>Tutor notes</span>
              <p>{profile?.tutorNotes.join(" / ")}</p>
            </div>
          </div>

          <div className="recent-sessions">
            <span className="eyebrow">Recent Sessions</span>
            {profile?.recentSessions.map((session) => (
              <article className="session-line" key={session.id}>
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.summary}</p>
                </div>
                <div className="session-line-meta">
                  <span>{formatRelativeDate(session.dateIso)}</span>
                  <span>{session.durationMinutes} min</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="transcript-column">
          <div className="section-heading">
            <span className="eyebrow">Conversation Flow</span>
            <h3>Speech first, text only as a support rail.</h3>
          </div>

          <div className="transcript-list">
            {deferredTranscript.length === 0 && (
              <p className="empty-copy">
                Start a session and the running conversation will collect here in lightweight
                transcript form.
              </p>
            )}
            {deferredTranscript.map((turn) => (
              <div className={`transcript-line ${turn.speaker}`} key={turn.id}>
                <small>{turn.speaker === "you" ? "You" : "Tutor"}</small>
                <p>{turn.text}</p>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="culture-section">
        <div className="section-heading">
          <span className="eyebrow">Modern Italy Cues</span>
          <h3>Culture woven into the speaking prompts, not bolted on afterward.</h3>
        </div>

        <div className="culture-gallery">
          {heroScenes.map((scene) => (
            <article className="culture-scene" key={scene.title}>
              <img alt={scene.title} src={scene.image} />
              <div>
                <small>{scene.eyebrow}</small>
                <h4>{scene.title}</h4>
                <p>{scene.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="reflection-section">
        <div className="section-heading">
          <span className="eyebrow">After The Session</span>
          <h3>Every conversation feeds the next lesson.</h3>
        </div>

        {isSaving && <p className="saving-copy">Saving your lesson memory and next-step drills.</p>}

        {reflection ? (
          <div className="reflection-grid">
            <div>
              <small>Lesson arc</small>
              <h4>{reflection.title}</h4>
              <p>{reflection.summary}</p>
            </div>
            <div>
              <small>What worked</small>
              <ul>
                {reflection.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <small>Next speaking drills</small>
              <ul>
                {reflection.nextDrills.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <small>Fresh vocabulary</small>
              <ul>
                {reflection.vocabulary.map((item) => (
                  <li key={item.italian}>
                    {item.italian} - {item.english}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="empty-copy">
            End a lesson and Parola Viva writes a short memory note, new vocabulary list,
            and next-session focus for the tutor.
          </p>
        )}
      </section>
    </main>
  );
}
