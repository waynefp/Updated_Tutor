import { medianMs } from "../lib/replyTimer";
import type { AudioInputDevice, RealtimeEventLogItem, VoiceEngine } from "../types";

const ENGINES: Array<{ id: VoiceEngine; label: string; note: string }> = [
  { id: "gemini", label: "Gemini", note: "Google Gemini Live" },
  { id: "openai", label: "OpenAI", note: "gpt-realtime" },
  { id: "gptlive", label: "GPT-Live", note: "Full-duplex, about $0.05/min" }
];

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  locked: boolean;
  voiceEngine: VoiceEngine;
  onVoiceEngine: (engine: VoiceEngine) => void;
  geminiModels: Array<{ id: string; label: string }>;
  geminiModel: string;
  onGeminiModel: (model: string) => void;
  audioInputs: AudioInputDevice[];
  selectedAudioInputId: string;
  onAudioInput: (deviceId: string) => void;
  replyTimesMs: number[];
  eventLog: RealtimeEventLogItem[];
  showDebug: boolean;
};

export function SettingsDrawer(props: SettingsDrawerProps) {
  if (!props.open) return null;
  const median = medianMs(props.replyTimesMs);

  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <h2 className="small-caps">Impostazioni</h2>
          <button type="button" className="gloss-dismiss" onClick={props.onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        {props.locked && <p className="quiet">Settings lock while a lesson is running.</p>}

        <fieldset className="field" disabled={props.locked}>
          <legend>Voce di Lucia</legend>
          <div className="segmented" role="radiogroup" aria-label="Voice engine">
            {ENGINES.map((engine) => (
              <button
                key={engine.id}
                type="button"
                role="radio"
                aria-checked={props.voiceEngine === engine.id}
                className={props.voiceEngine === engine.id ? "active" : undefined}
                onClick={() => props.onVoiceEngine(engine.id)}
              >
                {engine.label}
                <small>{engine.note}</small>
              </button>
            ))}
          </div>
        </fieldset>

        {props.voiceEngine === "gemini" && props.geminiModels.length > 0 && (
          <label className="field">
            <span className="legend">Modello Gemini</span>
            <select
              id="gemini-model-select"
              value={props.geminiModel}
              onChange={(event) => props.onGeminiModel(event.target.value)}
              disabled={props.locked}
            >
              {props.geminiModels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span className="legend">Microfono</span>
          <select
            id="audio-input-select"
            value={props.selectedAudioInputId}
            onChange={(event) => props.onAudioInput(event.target.value)}
            disabled={props.locked}
          >
            {props.audioInputs.length === 0 && <option value="">Default microphone</option>}
            {props.audioInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
                {device.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>

        {props.replyTimesMs.length > 0 && (
          <p className="quiet">
            Last lesson: Lucia answered in about {((median ?? 0) / 1000).toFixed(1)}s (median of{" "}
            {props.replyTimesMs.length} replies).
          </p>
        )}

        {props.showDebug && (
          <section className="debug-log">
            <h3 className="small-caps">Connection log</h3>
            <ol>
              {props.eventLog.map((item) => (
                <li key={item.id}>
                  <b>{item.type}</b>
                  {item.detail ? ` ${item.detail}` : ""}
                </li>
              ))}
            </ol>
            <a
              className="text-link"
              href={`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/debug/prompt`}
              target="_blank"
              rel="noreferrer"
            >
              See the prompt Lucia gets →
            </a>
          </section>
        )}
      </aside>
    </div>
  );
}
