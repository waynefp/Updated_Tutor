import { useEffect, useState } from "react";
import { medianMs } from "../lib/replyTimer";
import type { LessonTurn, SessionPreset, SessionStatus } from "../types";

type LessonViewProps = {
  preset: SessionPreset;
  status: SessionStatus;
  error: string | null;
  liveTutorCaption: string;
  liveUserCaption: string;
  transcript: LessonTurn[];
  micLevel: number;
  replyTimesMs: number[];
  onEnd: () => void;
  onLeaveAfterError: () => void;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Un momento…",
  connecting: "Chiamo Lucia…",
  ready: "Ti ascolto",
  listening: "Ti ascolto…",
  speaking: "Lucia parla",
  error: "Qualcosa non va"
};

function useElapsed(running: boolean) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const seconds = Math.floor((now - startedAt) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LessonView(props: LessonViewProps) {
  const { preset, status, error, transcript } = props;
  const [showTranscript, setShowTranscript] = useState(false);
  const live = status === "ready" || status === "listening" || status === "speaking";
  const elapsed = useElapsed(live);
  const median = medianMs(props.replyTimesMs);

  // The last word from each side: the live caption if one is forming,
  // otherwise the latest finished turn.
  const lastTutor =
    props.liveTutorCaption || [...transcript].reverse().find((turn) => turn.speaker === "tutor")?.text || "";
  const lastYou =
    props.liveUserCaption || [...transcript].reverse().find((turn) => turn.speaker === "you")?.text || "";

  const goal =
    preset.mode === "mission"
      ? "Tell Lucia why Italian"
      : preset.mode === "chat"
        ? "Solo chiacchiere: no goal, just talk"
        : preset.focus;

  return (
    <div className="lesson" role="dialog" aria-modal="true" aria-label="Lesson with Lucia">
      <header className="lesson-top">
        <span className="lesson-live">{live ? "● Con Lucia" : "○ Con Lucia"}</span>
        <span className="lesson-time" aria-label="Lesson time">
          {elapsed}
        </span>
      </header>

      <p className="lesson-goal">
        <span className="small-caps">Obiettivo</span> {goal}
      </p>

      <div
        className={`lesson-ring ${status}`}
        style={{ ["--mic" as string]: String(Math.min(1, props.micLevel)) }}
        aria-live="polite"
      >
        <span>{STATUS_LABEL[status]}</span>
      </div>

      {error ? (
        <div className="lesson-error" role="alert">
          <p>{error}</p>
          <button type="button" className="lesson-button" onClick={props.onLeaveAfterError}>
            Torna al codice
          </button>
        </div>
      ) : (
        <div className="lesson-captions">
          <p className="caption tutor">
            <small>Lucia</small>
            {lastTutor || "…"}
          </p>
          <p className="caption you">
            <small>Tu</small>
            {lastYou || "Quando parli, le tue parole appaiono qui."}
          </p>
        </div>
      )}

      {showTranscript && (
        <ol className="lesson-transcript" aria-label="Conversation so far">
          {transcript.map((turn) => (
            <li key={turn.id} className={turn.speaker}>
              <small>{turn.speaker === "you" ? "Tu" : "Lucia"}</small>
              {turn.text}
            </li>
          ))}
        </ol>
      )}

      <footer className="lesson-bottom">
        <div className="lesson-meta">
          <button type="button" className="text-link light" onClick={() => setShowTranscript((value) => !value)}>
            {showTranscript ? "Nascondi la conversazione" : `Tutta la conversazione (${transcript.length})`}
          </button>
          {median !== null && <span>risposta ~{(median / 1000).toFixed(1)}s</span>}
        </div>
        {!error && (
          <button type="button" className="lesson-button finish" onClick={props.onEnd} disabled={status === "connecting"}>
            Fine e salva
          </button>
        )}
      </footer>
    </div>
  );
}
