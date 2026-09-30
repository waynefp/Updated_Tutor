import { reviewLabel } from "../lib/format";
import type { SavedVocabulary, TutorProfile, VocabularyStage } from "../types";
import { Hatch, LeonardoGloss } from "./codex";

const GROUPS: Array<{ stage: VocabularyStage; title: string; note: string }> = [
  { stage: "practicing", title: "In pratica", note: "You've used these on your own at least once." },
  { stage: "new", title: "Nuove", note: "Met, but not yet said without help." },
  { stage: "mastered", title: "Tue", note: "Used on your own in three different lessons." }
];

function WordRow({ word, due }: { word: SavedVocabulary; due: boolean }) {
  return (
    <li>
      <Hatch stage={word.stage} />
      <span className="word">
        {word.italian}
        <span className="gloss-inline">{word.english}</span>
      </span>
      <span className="leader" aria-hidden="true" />
      <em className={due ? "due" : undefined}>{reviewLabel(word.nextReviewAt)}</em>
    </li>
  );
}

export function WordsPage({ profile }: { profile: TutorProfile }) {
  const due = new Set(profile.reviewDue);
  return (
    <div className="single-page">
      <section className="page">
        <span className="small-caps">Parole · {profile.recentVocabulary.length}</span>
        <h1 className="page-title">Le mie parole</h1>
        <p className="english">
          Words move up only when you use them on your own. Hearing a word, or repeating it straight after Lucia,
          doesn't count yet. Each right answer pushes its next review further out: 1, 3, 7, 14, then 30 days.
        </p>
        <div className="stage-key" aria-hidden="true">
          <span>
            <Hatch stage="new" /> nuova
          </span>
          <span>
            <Hatch stage="practicing" /> in pratica
          </span>
          <span>
            <Hatch stage="mastered" /> tua
          </span>
        </div>
        {GROUPS.map((group) => {
          const words = profile.recentVocabulary.filter((word) => (word.stage ?? "new") === group.stage);
          if (!words.length) return null;
          return (
            <section key={group.stage} className="word-group">
              <h2 className="small-caps">
                {group.title} · {words.length}
              </h2>
              <p className="quiet">{group.note}</p>
              <ul className="word-index">
                {words.map((word) => (
                  <WordRow key={word.italian} word={word} due={due.has(word.italian)} />
                ))}
              </ul>
            </section>
          );
        })}
        {!profile.recentVocabulary.length && <p className="quiet">Your words appear here after your first lesson.</p>}
      </section>
      <aside className="page-margin">
        <LeonardoGloss place="words" />
      </aside>
    </div>
  );
}
