import { colophonDate } from "../lib/format";
import type { LessonReflection, TutorProfile, VocabularyStage } from "../types";
import { DropCap, Hatch, LeonardoGloss, SkeletalCube, STAGE_LABEL } from "./codex";

export function SavingView() {
  return (
    <div className="sheet-backdrop" role="status" aria-live="polite">
      <div className="saving">
        <span className="small-caps">Lezione finita</span>
        <SkeletalCube />
        <p className="saving-line">Lucia sta scrivendo nel tuo codice…</p>
        <p className="fleuron" aria-hidden="true">
          ❦
        </p>
        <LeonardoGloss place="saving" />
        <p className="quiet">Saving takes about ten seconds.</p>
      </div>
    </div>
  );
}

const RESULT_LINE: Record<LessonReflection["objectiveOutcome"]["result"], string> = {
  won: "Hai vinto.",
  partly: "Quasi.",
  not_yet: "Non ancora.",
  no_objective: "Grazie della chiacchierata."
};

const EVIDENCE_LABEL: Record<LessonReflection["vocabulary"][number]["evidence"], string> = {
  used_unprompted: "da solo",
  used_with_help: "con aiuto",
  not_recalled: "non ricordata",
  heard_only: "sentita"
};

const AUDIT_MARK = { yes: "✓", no: "✗", not_applicable: "–" } as const;

type SummarySheetProps = {
  reflection: LessonReflection;
  before: TutorProfile | null;
  after: TutorProfile;
  onClose: () => void;
};

export function SummarySheet({ reflection, before, after, onClose }: SummarySheetProps) {
  const folio = after.sessionCount;
  const beforeStage = new Map(
    (before?.recentVocabulary ?? []).map((word) => [word.italian.toLowerCase(), word.stage])
  );
  const afterStage = new Map(after.recentVocabulary.map((word) => [word.italian.toLowerCase(), word.stage]));

  const practised = reflection.vocabulary.filter((word) => word.evidence !== "heard_only");
  const heard = reflection.vocabulary.filter(
    (word) => word.evidence === "heard_only" && !beforeStage.has(word.italian.toLowerCase())
  );
  const outcome = reflection.objectiveOutcome;

  return (
    <div className="sheet-backdrop">
      <article className="sheet" role="dialog" aria-modal="true" aria-label="Lesson summary">
        <span className="small-caps centered">
          <span className="folio-mark">f. {folio}v</span> · Riepilogo
        </span>

        <p className="lead">
          <DropCap text={RESULT_LINE[outcome.result]} />{" "}
          {outcome.result === "no_objective" ? reflection.title : outcome.evidence}
        </p>
        <p className="english">{reflection.summary}</p>

        {reflection.traps.length > 0 && (
          <section>
            <span className="small-caps">Errata</span>
            <ul className="errata">
              {reflection.traps.map((trap) => (
                <li key={trap.wrong}>
                  <s>{trap.wrong}</s> <span className="leggi">leggi</span> <b>{trap.right}</b>
                  {trap.fixedThisSession && <em className="quiet"> · corretto da solo</em>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {practised.length > 0 && (
          <section>
            <span className="small-caps">Parole</span>
            <ul className="word-index">
              {practised.map((word) => {
                const key = word.italian.toLowerCase();
                const from = beforeStage.get(key);
                const to: VocabularyStage = afterStage.get(key) ?? "new";
                return (
                  <li key={word.italian}>
                    <Hatch stage={to} />
                    <span className="word">{word.italian}</span>
                    <span className="leader" aria-hidden="true" />
                    <em className={from !== to ? "due" : undefined}>
                      {from && from !== to ? `${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}` : STAGE_LABEL[to]}
                      {" · "}
                      {EVIDENCE_LABEL[word.evidence]}
                    </em>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {heard.length > 0 && (
          <p className="quiet">
            <span className="small-caps">Sentite</span> {heard.map((word) => word.italian).join(" · ")}
            <br />
            New words you heard but haven't said yet. They count once you use them.
          </p>
        )}

        {reflection.mission && (
          <section className="mission-card">
            <span className="small-caps">La tua missione</span>
            <p>{reflection.mission.why}</p>
            {reflection.mission.successLooksLike.length > 0 && (
              <ul>
                {reflection.mission.successLooksLike.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {reflection.nextSessionPlan.objective && (
          <p className="hand">Prossima volta: {reflection.nextSessionPlan.objective} — L.</p>
        )}

        {reflection.lessonAudit.length > 0 && (
          <details className="audit">
            <summary>Come ha insegnato Lucia</summary>
            <ul>
              {reflection.lessonAudit.map((item) => (
                <li key={item.rule} className={`audit-${item.followed}`}>
                  <span className="audit-mark" aria-label={item.followed.replace("_", " ")}>
                    {AUDIT_MARK[item.followed]}
                  </span>
                  <span>
                    {item.rule}
                    <em>{item.evidence}</em>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <LeonardoGloss place="summary" />

        <p className="colophon">
          Finito di parlare il {colophonDate()},
          <br />
          con Lucia.
        </p>

        <button type="button" className="start-button" onClick={onClose}>
          <span>Chiudi il foglio</span>
        </button>
      </article>
    </div>
  );
}
