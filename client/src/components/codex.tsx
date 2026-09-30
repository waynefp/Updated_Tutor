import { useState, type ReactNode } from "react";
import { pickLeonardoNote, type NotePlace } from "../content/leonardo-notes";
import type { VocabularyStage } from "../types";

export const STAGE_LABEL: Record<VocabularyStage, string> = {
  new: "nuova",
  practicing: "in pratica",
  mastered: "tua"
};

// Word strength as Leonardo's left-handed hatching: sparse, dense, cross-hatched.
export function Hatch({ stage = "new" }: { stage?: VocabularyStage }) {
  return <i className={`hatch hatch-${stage}`} aria-hidden="true" />;
}

// Faint circle-and-square proportion study behind the day's goal.
export function ConstructionFrame({ children }: { children: ReactNode }) {
  return (
    <div className="construction">
      <svg viewBox="0 0 300 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="150" cy="60" r="57" />
          <rect x="99" y="9" width="102" height="102" />
          <line x1="99" y1="9" x2="201" y2="111" />
          <line x1="201" y1="9" x2="99" y2="111" />
          <line x1="30" y1="60" x2="270" y2="60" strokeDasharray="3 4" />
        </g>
      </svg>
      <div className="construction-content">{children}</div>
    </div>
  );
}

// A review word written in mirror script, so it can't simply be read before
// Lucia asks. Tapping turns it round; screen readers get a clear label.
export function MirrorWord({ word, revealed = false }: { word: string; revealed?: boolean }) {
  const [flipped, setFlipped] = useState(revealed);
  return (
    <button
      type="button"
      className={flipped ? "mirror-word revealed" : "mirror-word"}
      onClick={() => setFlipped((value) => !value)}
      aria-label={flipped ? word : "Review word, hidden until Lucia asks. Activate to reveal it."}
      aria-pressed={flipped}
    >
      <span aria-hidden="true">{word}</span>
    </button>
  );
}

// A Leonardo note set as a printed marginal gloss. One per screen, dismissable.
export function LeonardoGloss({ place }: { place: NotePlace }) {
  const [note] = useState(() => pickLeonardoNote(place));
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <aside className="gloss leonardo-gloss" aria-label="A note about Leonardo">
      <button
        type="button"
        className="gloss-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss this note"
      >
        ×
      </button>
      <p>
        <span className="manicule" aria-hidden="true">
          ☞
        </span>{" "}
        {note.text}
      </p>
      <span className="gloss-source">{note.source}</span>
    </aside>
  );
}

// A skeletal cube like the solids Leonardo drew for Pacioli; turns while saving.
export function SkeletalCube() {
  return (
    <svg className="skeletal-cube" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <polygon points="32,6 54.5,19 54.5,45 32,58 9.5,45 9.5,19" />
        <line x1="32" y1="32" x2="32" y2="58" />
        <line x1="32" y1="32" x2="9.5" y2="19" />
        <line x1="32" y1="32" x2="54.5" y2="19" />
        <g strokeDasharray="2 3" strokeOpacity="0.6">
          <line x1="32" y1="32" x2="32" y2="6" />
          <line x1="32" y1="32" x2="54.5" y2="45" />
          <line x1="32" y1="32" x2="9.5" y2="45" />
        </g>
      </g>
    </svg>
  );
}

// First letter set as a red initial, as in an Aldine book.
export function DropCap({ text }: { text: string }) {
  const [first, ...rest] = Array.from(text);
  return (
    <>
      <span className="drop-cap" aria-hidden="true">
        {first}
      </span>
      <span className="visually-hidden">{first}</span>
      {rest.join("")}
    </>
  );
}
