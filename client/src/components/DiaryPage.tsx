import { italianDate } from "../lib/format";
import type { LearningRecord, RecentSession, TutorProfile } from "../types";
import { LeonardoGloss } from "./codex";

const RECORD_KIND: Record<LearningRecord["kind"], string> = {
  demonstrated: "Mostrato",
  prior_knowledge: "Già noto",
  misconception_corrected: "Corretto",
  mission_shift: "Missione cambiata"
};

const RESULT_LABEL: Record<NonNullable<RecentSession["objectiveResult"]>, string> = {
  won: "vinto",
  partly: "quasi",
  not_yet: "non ancora",
  no_objective: ""
};

type DiaryPageProps = {
  profile: TutorProfile;
  onStartMission: () => void;
};

export function DiaryPage({ profile, onStartMission }: DiaryPageProps) {
  const sessions = profile.recentSessions;
  return (
    <div className="single-page">
      <section className="page">
        <span className="small-caps">Diario</span>
        <h1 className="page-title">Il diario</h1>

        <section className="mission-card">
          <span className="small-caps">La tua missione</span>
          {profile.mission ? (
            <>
              <p>{profile.mission.why}</p>
              {profile.mission.successLooksLike.length > 0 && (
                <ul>
                  {profile.mission.successLooksLike.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {profile.mission.constraints.length > 0 && (
                <p className="quiet">{profile.mission.constraints.join(" · ")}</p>
              )}
              <button type="button" className="text-link" onClick={onStartMission}>
                Talk it over with Lucia again →
              </button>
            </>
          ) : (
            <>
              <p className="quiet">
                Not set yet. A five-minute conversation with Lucia about why you're learning. Every lesson after it is
                chosen from your answer.
              </p>
              <button type="button" className="text-link" onClick={onStartMission}>
                Set your mission →
              </button>
            </>
          )}
        </section>

        <p className="fleuron" aria-hidden="true">
          ❦
        </p>

        <h2 className="small-caps">Cosa hai imparato</h2>
        {profile.learningRecords.length ? (
          <ul className="records">
            {profile.learningRecords.map((record) => (
              <li key={record.id}>
                <span className="record-kind">{RECORD_KIND[record.kind]}</span>
                <span className="record-date">{italianDate(record.dateIso)}</span>
                <p>
                  {record.title}
                  <span className="evidence">{record.evidence}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">
            Nothing recorded yet. A record is written only when a lesson shows real evidence, never for just covering
            something.
          </p>
        )}

        <p className="fleuron" aria-hidden="true">
          ❦
        </p>

        <h2 className="small-caps">Le lezioni</h2>
        {sessions.length ? (
          <ol className="folios">
            {sessions.map((session, index) => {
              const folio = profile.sessionCount - index;
              const result = session.objectiveResult ? RESULT_LABEL[session.objectiveResult] : "";
              return (
                <li key={session.id}>
                  <span className="folio-number">f. {folio}</span>
                  <div>
                    <p className="folio-title">
                      {session.title}
                      {result && <em className={`result result-${session.objectiveResult}`}>{result}</em>}
                    </p>
                    <p className="folio-meta">
                      {italianDate(session.dateIso)} · {session.durationMinutes} min
                      {session.objective ? ` · ${session.objective}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="quiet">Your first lesson will be folio 1.</p>
        )}

        {profile.journey.length > 0 && (
          <>
            <p className="fleuron" aria-hidden="true">
              ❦
            </p>
            <h2 className="small-caps">Il viaggio</h2>
            <div className="journey">
              {profile.journey.map((entry) => (
                <p key={entry}>{entry}</p>
              ))}
            </div>
          </>
        )}
      </section>
      <aside className="page-margin">
        <LeonardoGloss place="diary" />
      </aside>
    </div>
  );
}
