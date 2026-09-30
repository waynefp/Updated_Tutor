import { useRef, useState } from "react";
import type { SavedVocabulary, SessionPreset, TutorProfile } from "../types";
import { ConstructionFrame, DropCap, Hatch, LeonardoGloss, MirrorWord, STAGE_LABEL } from "./codex";

type HomeSpreadProps = {
  profile: TutorProfile;
  presets: SessionPreset[];
  activePreset: SessionPreset;
  onSelectPreset: (preset: SessionPreset) => void;
  onStart: () => void;
  onOpenWords: () => void;
  onOpenDiary: () => void;
  startDisabled: boolean;
};

const stageOrder = { practicing: 0, new: 1, mastered: 2 } as const;

// Due words first, then words being practised, then new, then the learner's own.
function indexWords(words: SavedVocabulary[], due: string[]) {
  const dueSet = new Set(due);
  return [...words]
    .sort((a, b) => {
      const byDue = Number(dueSet.has(b.italian)) - Number(dueSet.has(a.italian));
      if (byDue !== 0) return byDue;
      return stageOrder[a.stage ?? "new"] - stageOrder[b.stage ?? "new"];
    })
    .slice(0, 7);
}

function LeftPage({
  profile,
  presets,
  activePreset,
  onSelectPreset,
  onStart,
  startDisabled
}: Omit<HomeSpreadProps, "onOpenWords" | "onOpenDiary">) {
  const mode = activePreset.mode;
  const otherPresets = presets.filter((preset) => preset.id !== activePreset.id);
  const showReview = (mode === "plan" || mode === "topic") && profile.reviewDue.length > 0;

  const opening =
    mode === "mission"
      ? { line: "Prima di tutto: perché l'italiano?", english: "Before anything else, Lucia wants to know why you're learning." }
      : mode === "chat"
        ? { line: "Oggi niente lezione: solo chiacchiere.", english: "No lesson today. Just talk." }
        : { line: "Oggi vinciamo una cosa sola.", english: "Today we win just one thing." };

  const goal =
    mode === "mission"
      ? "Tell Lucia why Italian, and what success would look like."
      : mode === "chat"
        ? "Talk about whatever you like, in whatever Italian you have."
        : activePreset.focus;

  return (
    <section className="page page-left" aria-label="Today">
      <span className="small-caps">
        Oggi · {activePreset.label}
      </span>
      <p className="lead">
        <DropCap text={opening.line} /> <em className="english">{opening.english}</em>
      </p>

      <ConstructionFrame>
        <p className="goal">
          <span className="manicule" aria-hidden="true">
            ☞
          </span>{" "}
          {goal}
        </p>
      </ConstructionFrame>

      {showReview && (
        <div className="review">
          <span className="small-caps">Ti ricordi…?</span>
          <div className="mirror-row">
            {profile.reviewDue.map((word) => (
              <MirrorWord key={word} word={word} />
            ))}
          </div>
          <p className="hand">Non sbirciare. Te lo chiedo io. — L.</p>
        </div>
      )}

      <div className="start-block">
        <button type="button" className="start-button" onClick={onStart} disabled={startDisabled}>
          <span>{mode === "mission" ? "Parla con Lucia" : "Inizia la lezione"}</span>
          <small>Festina lente</small>
        </button>
        <label className="other-lessons">
          <span>oppure</span>
          <select
            value=""
            onChange={(event) => {
              const next = otherPresets.find((preset) => preset.id === event.target.value);
              if (next) onSelectPreset(next);
            }}
            aria-label="Choose a different kind of lesson"
          >
            <option value="" disabled>
              scegli un'altra lezione…
            </option>
            {otherPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} · {preset.brief}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function RightPage({
  profile,
  onOpenWords,
  onOpenDiary
}: Pick<HomeSpreadProps, "profile" | "onOpenWords" | "onOpenDiary">) {
  const words = indexWords(profile.recentVocabulary, profile.reviewDue);
  const due = new Set(profile.reviewDue);
  const latestRecord = profile.learningRecords[0];
  const lastSession = profile.recentSessions[0];

  return (
    <section className="page page-right" aria-label="Your progress">
      <div className="page-main">
        <span className="small-caps">Indice delle parole · {profile.recentVocabulary.length}</span>
        {words.length ? (
          <ul className="word-index">
            {words.map((word) => (
              <li key={word.italian}>
                <Hatch stage={word.stage} />
                <span className="word">{word.italian}</span>
                <span className="leader" aria-hidden="true" />
                <em className={due.has(word.italian) ? "due" : undefined}>
                  {due.has(word.italian) ? "oggi" : STAGE_LABEL[word.stage ?? "new"]}
                </em>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">Your first words appear here after your first lesson.</p>
        )}
        <button type="button" className="text-link" onClick={onOpenWords}>
          Tutte le parole →
        </button>

        <p className="fleuron" aria-hidden="true">
          ❦
        </p>

        <span className="small-caps">Errata</span>
        {profile.traps.length ? (
          <ul className="errata">
            {profile.traps.slice(0, 3).map((trap) => (
              <li key={trap.id}>
                <s>{trap.wrong}</s> <span className="leggi">leggi</span> <b>{trap.right}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">No traps yet. Lucia notes your mistakes here to re-check later.</p>
        )}

        <p className="fleuron" aria-hidden="true">
          ❦
        </p>

        <span className="small-caps">Diario</span>
        {latestRecord ? (
          <p className="record">
            {latestRecord.title}
            <span className="evidence">{latestRecord.evidence}</span>
          </p>
        ) : lastSession ? (
          <p className="record">
            {lastSession.title}
            <span className="evidence">{lastSession.summary}</span>
          </p>
        ) : (
          <p className="quiet">Your journal starts with your first lesson.</p>
        )}
        <button type="button" className="text-link" onClick={onOpenDiary}>
          Il diario →
        </button>
      </div>
      <div className="page-margin">
        <LeonardoGloss place="home" />
      </div>
    </section>
  );
}

// Layout C: an open codex. Side by side on wide screens; on a phone the two
// pages sit in a swipeable strip with page dots.
export function HomeSpread(props: HomeSpreadProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  function goToPage(index: number) {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollTo({ left: index * strip.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="spread-wrap">
      <div
        className="spread"
        ref={stripRef}
        onScroll={(event) => {
          const strip = event.currentTarget;
          setPage(Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)));
        }}
      >
        <LeftPage {...props} />
        <RightPage profile={props.profile} onOpenWords={props.onOpenWords} onOpenDiary={props.onOpenDiary} />
      </div>
      <div className="page-dots" role="tablist" aria-label="Notebook pages">
        {["Oggi", "Le tue pagine"].map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={page === index}
            aria-label={label}
            className={page === index ? "dot active" : "dot"}
            onClick={() => goToPage(index)}
          />
        ))}
      </div>
    </div>
  );
}
