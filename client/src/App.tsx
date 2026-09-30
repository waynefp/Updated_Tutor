import { startTransition, useCallback, useEffect, useState } from "react";
import { fetchBootstrap, reflectLesson } from "./lib/api";
import { useRealtimeTutorSession } from "./hooks/useRealtimeTutorSession";
import { useOpenAiRealtimeSession } from "./hooks/useOpenAiRealtimeSession";
import { useGptLiveSession } from "./hooks/useGptLiveSession";
import { HomeSpread } from "./components/HomeSpread";
import { LessonView } from "./components/LessonView";
import { SavingView, SummarySheet } from "./components/SummarySheet";
import { WordsPage } from "./components/WordsPage";
import { DiaryPage } from "./components/DiaryPage";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { PREVIEW_REFLECTION, PREVIEW_TRANSCRIPT, readPreviewScreen } from "./dev/previewData";
import type {
  AudioInputDevice,
  BootstrapPayload,
  LessonReflection,
  SessionPreset,
  TutorProfile,
  VoiceEngine
} from "./types";

type View = "oggi" | "parole" | "diario";

const audioDeviceStorageKey = "parola-viva.audio-input";
const voiceEngineStorageKey = "parola-viva.voice-engine";
const geminiModelStorageKey = "parola-viva.gemini-model";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "oggi", label: "Oggi" },
  { id: "parole", label: "Parole" },
  { id: "diario", label: "Diario" }
];

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
  const [profileBefore, setProfileBefore] = useState<TutorProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(
    () => window.localStorage.getItem(audioDeviceStorageKey) ?? ""
  );
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>(() => {
    const saved = window.localStorage.getItem(voiceEngineStorageKey);
    return saved === "openai" || saved === "gptlive" ? saved : "gemini";
  });
  const [geminiModel, setGeminiModel] = useState(
    () => window.localStorage.getItem(geminiModelStorageKey) ?? ""
  );
  // The page lives in the address (#parole, #diario) so it can be bookmarked.
  const [view, setViewState] = useState<View>(() => {
    const fromHash = window.location.hash.slice(1);
    return VIEWS.some((item) => item.id === fromHash) ? (fromHash as View) : "oggi";
  });
  const setView = useCallback((next: View) => {
    setViewState(next);
    window.history.replaceState(null, "", next === "oggi" ? window.location.pathname + window.location.search : `#${next}`);
    window.scrollTo({ top: 0 });
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [showDebug] = useState(() => new URLSearchParams(window.location.search).has("debug"));
  const [preview] = useState(readPreviewScreen);

  const geminiSession = useRealtimeTutorSession();
  const openAiSession = useOpenAiRealtimeSession();
  const gptLiveSession = useGptLiveSession();
  const activeSession =
    voiceEngine === "openai" ? openAiSession : voiceEngine === "gptlive" ? gptLiveSession : geminiSession;
  const { endSession, eventLog, error: sessionError, startSession, status } = activeSession;
  const isSessionLive = status === "ready" || status === "listening" || status === "speaking";

  const applyBootstrap = useCallback((payload: BootstrapPayload) => {
    setBootstrap(payload);
    setProfile(payload.profile);
    // The server orders presets: Missione first until a mission exists, then Lucia's plan.
    setActivePreset(payload.sessionPresets[0] ?? null);
    setGeminiModel((current) =>
      payload.app.geminiModels.some((option) => option.id === current)
        ? current
        : payload.app.geminiDefaultModel
    );
  }, []);

  useEffect(() => {
    fetchBootstrap()
      .then(applyBootstrap)
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load the app.");
      });
  }, [applyBootstrap]);

  useEffect(() => {
    async function loadAudioInputs() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const inputs = toAudioInputDevices(await navigator.mediaDevices.enumerateDevices());
      setAudioInputs(inputs);
      setSelectedAudioInputId((current) =>
        current && inputs.some((device) => device.deviceId === current) ? current : inputs[0]?.deviceId ?? ""
      );
    }
    void loadAudioInputs();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadAudioInputs);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", loadAudioInputs);
  }, []);

  useEffect(() => {
    if (selectedAudioInputId) window.localStorage.setItem(audioDeviceStorageKey, selectedAudioInputId);
  }, [selectedAudioInputId]);

  useEffect(() => {
    window.localStorage.setItem(voiceEngineStorageKey, voiceEngine);
  }, [voiceEngine]);

  useEffect(() => {
    if (geminiModel) window.localStorage.setItem(geminiModelStorageKey, geminiModel);
  }, [geminiModel]);

  // A lesson only saves through "Fine e salva": warn before the tab closes mid-lesson.
  useEffect(() => {
    if (!isSessionLive) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isSessionLive]);

  async function handleStart() {
    if (!activePreset) return;
    setReflection(null);
    setSaveError(null);
    setSummaryOpen(false);
    setLessonOpen(true);
    await startSession({
      deviceId: selectedAudioInputId || undefined,
      focus: activePreset.focus,
      model: geminiModel || undefined,
      presetLabel: activePreset.label
    });
    if (navigator.mediaDevices?.enumerateDevices) {
      setAudioInputs(toAudioInputDevices(await navigator.mediaDevices.enumerateDevices()));
    }
  }

  async function handleEnd() {
    if (!activePreset) return;
    const capture = await endSession();
    setLessonOpen(false);
    if (!capture || capture.turns.length === 0) return;

    setProfileBefore(profile);
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
        setSummaryOpen(true);
      });
      // Presets depend on memory (the new plan's goal, whether a mission exists).
      fetchBootstrap().then(applyBootstrap).catch(() => undefined);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Lucia couldn't save this lesson.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLeaveAfterError() {
    await endSession();
    setLessonOpen(false);
  }

  function selectMission() {
    const mission = bootstrap?.sessionPresets.find((preset) => preset.mode === "mission");
    if (mission) setActivePreset(mission);
    setView("oggi");
  }

  if (loadError && !bootstrap) {
    return (
      <main className="codex codex-message">
        <p className="small-caps">Parola Viva</p>
        <p className="lead">Il codice non si apre.</p>
        <p className="english">The app couldn't load: {loadError}</p>
      </main>
    );
  }

  if (!bootstrap || !profile || !activePreset) {
    return (
      <main className="codex codex-message" aria-busy="true">
        <p className="small-caps">Parola Viva</p>
        <p className="lead">Apro il codice…</p>
      </main>
    );
  }

  const folio = profile.sessionCount + 1;

  return (
    <>
      <main className="codex">
        <header className="running-head">
          <span className="brand">Codice di {profile.learnerName}</span>
          <nav className="tabs" aria-label="Notebook sections">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? "tab active" : "tab"}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className="tab gear"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
            >
              ⚙
            </button>
          </nav>
          <span className="folio">f. {folio}r</span>
        </header>

        <p className="mission-strip">
          {profile.mission ? (
            <>
              <span className="small-caps">Missione</span> {profile.mission.why}
            </>
          ) : (
            <button type="button" className="text-link" onClick={selectMission}>
              <span className="small-caps">Missione</span> not set yet: five minutes with Lucia →
            </button>
          )}
        </p>

        {saveError && (
          <p className="save-error" role="alert">
            {saveError}
          </p>
        )}

        {view === "oggi" && (
          <HomeSpread
            profile={profile}
            presets={bootstrap.sessionPresets}
            activePreset={activePreset}
            onSelectPreset={setActivePreset}
            onStart={handleStart}
            onOpenWords={() => setView("parole")}
            onOpenDiary={() => setView("diario")}
            startDisabled={status === "connecting" || isSessionLive || isSaving}
          />
        )}
        {view === "parole" && <WordsPage profile={profile} />}
        {view === "diario" && <DiaryPage profile={profile} onStartMission={selectMission} />}
      </main>

      {preview === "lesson" && (
        <LessonView
          preset={activePreset}
          status="speaking"
          error={null}
          liveTutorCaption="Perfetto! E adesso tu: di dove sei?"
          liveUserCaption=""
          transcript={PREVIEW_TRANSCRIPT}
          micLevel={0.2}
          replyTimesMs={[1180, 1260, 1320]}
          onEnd={() => undefined}
          onLeaveAfterError={() => undefined}
        />
      )}
      {preview === "saving" && <SavingView />}
      {preview === "summary" && (
        <SummarySheet reflection={PREVIEW_REFLECTION} before={profile} after={profile} onClose={() => undefined} />
      )}

      {lessonOpen && (
        <LessonView
          preset={activePreset}
          status={status}
          error={sessionError}
          liveTutorCaption={activeSession.liveTutorCaption}
          liveUserCaption={activeSession.liveUserCaption}
          transcript={activeSession.transcript}
          micLevel={activeSession.micLevel}
          replyTimesMs={activeSession.replyTimesMs}
          onEnd={handleEnd}
          onLeaveAfterError={handleLeaveAfterError}
        />
      )}

      {isSaving && <SavingView />}

      {summaryOpen && reflection && (
        <SummarySheet
          reflection={reflection}
          before={profileBefore}
          after={profile}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      <SettingsDrawer
        open={settingsOpen || preview === "settings"}
        onClose={() => setSettingsOpen(false)}
        locked={status === "connecting" || isSessionLive}
        voiceEngine={voiceEngine}
        onVoiceEngine={setVoiceEngine}
        geminiModels={bootstrap.app.geminiModels}
        geminiModel={geminiModel}
        onGeminiModel={setGeminiModel}
        audioInputs={audioInputs}
        selectedAudioInputId={selectedAudioInputId}
        onAudioInput={setSelectedAudioInputId}
        replyTimesMs={activeSession.replyTimesMs}
        eventLog={eventLog}
        showDebug={showDebug}
      />
    </>
  );
}
