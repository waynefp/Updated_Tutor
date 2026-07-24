# Parola Viva — Project Handoff

*Last updated: 2026-07-24 · Branch: `feature/openai-realtime` (PR [#2](https://github.com/waynefp/Updated_Tutor/pull/2), open, mergeable) · Production: `main` (Gemini-only)*

## What this app is

A voice-first Italian tutor for a single learner (Wayne, A1 level). The user speaks into the mic, audio streams in real time to a voice AI, and after each session an OpenAI reflection updates a persistent learner profile so the tutor **never starts from scratch** — it greets the learner by name, references the last session, warms up with the weakest vocabulary, and follows a plan it wrote for itself at the end of the previous session.

## The two voice engines

An in-app toggle (Speaking Studio panel, persisted in localStorage, locked mid-session) selects the engine before each session:

| | **Gemini** (original) | **OpenAI** (this branch) |
|---|---|---|
| Model | `gemini-3.1-flash-live-preview` | `gpt-realtime-2.1`, voice `marin` |
| Transport | Raw WebSocket, PCM 16kHz in / 24kHz out | WebRTC (native audio + `oai-events` data channel) |
| Auth | Raw API key sent to browser (legacy tradeoff) | Ephemeral client secret minted server-side (~60s TTL) |
| Client hook | `client/src/hooks/useRealtimeTutorSession.ts` | `client/src/hooks/useOpenAiRealtimeSession.ts` |
| Server route | `POST /api/live/session` | `POST /api/live/openai-session` |

Both hooks expose an **identical interface** (`status`, `transcript`, captions, `micLevel`, `startSession`, `endSession`), so `App.tsx` mounts both and switches by engine; everything downstream (reflection, UI) is engine-agnostic.

**Live-testing verdicts (Wayne, 2026-07-17/18):** Gemini is smoother, lower-latency, better Italian accent — but delivered Italian in oversized chunks (fixed via "ITALIAN DOSAGE" prompt block, Gemini-only). OpenAI has better teaching pacing but higher latency and pausey interruptions (mitigated via `semantic_vad` + `eagerness: "high"`); accent needed two rounds of strengthening (engine-gated "VOICE AND ACCENT" block). Some latency gap is intrinsic — Gemini Live is best-in-class at raw voice latency.

**Remaining tuning levers if OpenAI still lags:** `gpt-realtime-2.1-mini` (faster/cheaper), voice `cedar` (takes accent direction more strongly), `server_vad` with tuned silence (risks cutting off a hesitant learner). Model/voice are env-switchable: `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` (code defaults: `gpt-realtime-2.1` / `marin`).

## The memory system (the heart of the app)

**Flow:** session ends → "End and save lesson" → `POST /api/lessons/reflect` → `gpt-4.1-mini` (strict JSON schema, `server/lib/reflection.ts`) → merged into memory (`server/lib/memoryStore.ts`) → next session's instructions (`server/lib/prompts.ts:buildTutorInstructions`) include a CONTINUITY block.

**Memory schema** (`server/lib/types.ts`): vocabulary with `strength` 1–5 + `lastPracticedAt` (max 60), curriculum (`mastered` / `workingOn` / `strugglingWith`), append-only `journey` narrative (max 24 entries), `nextSessionPlan` (`openerNote`, `warmupVocabulary`, `reinforce`, `introduce`), session records (max 20). Old-shape files are normalized on load.

**Storage:**
- **Local dev:** `server/data/default-user.json` (plain file).
- **Vercel (Production + Preview):** Vercel Blob store `parola-viva-memory` (`store_Af9B464jf6gVhzjw`), pathname `parola-viva/memory.json`. Durable across deploys/instances. Verified seeded and working 2026-07-17.
- **Blob auth is OIDC** (the 2026 default): env var `BLOB_STORE_ID` + a token Vercel injects via *request context* in deployed functions — there is **no** `BLOB_READ_WRITE_TOKEN` and `VERCEL_OIDC_TOKEN` appears as an env var only in `vercel env pull` output, not in the deployed runtime. The gate in `memoryStore.ts:useBlob()` reflects this. Blob write failures degrade to /tmp + in-memory cache rather than failing requests. Blob reads use `cacheControlMaxAge: 60` plus a newest-wins in-memory cache.

**Session cadence:** no time gating — multiple sessions per day chain correctly. The only rule: end with **"End and save lesson"**; closing the tab leaves no memory.

## Diagnostics

`GET /api/health` on any deployment returns storage mode + models:
`{ "storage": { "mode": "blob", "seeded": true, ... }, "models": { "gemini": ..., "openai": ... } }`
`mode: "ephemeral"` on Vercel means the Blob connection is broken. The in-app "Connection log" shows realtime events; unknown OpenAI events log as `server.unknown` instead of crashing.

## Deployment (Vercel)

- Project `parola-viva`, team `waynefps-projects`, repo `waynefp/Updated_Tutor`. Client → static `dist/`, server → one serverless function (`api/index.ts` re-exports `server/app.ts`); `vercel.json` rewrites `/api/(.*)` → `/api`, SPA fallback. **Never set `framework: "vite"`** — it breaks API routing.
- Every push to the branch auto-deploys a preview; the stable preview URL is the branch alias `parola-viva-git-feature-openai-realtime-waynefps-projects.vercel.app` (requires Vercel login — deployment protection).
- **Env vars apply only to deployments created after the change — redeploy after changing them.** Three ways: Deployments tab → "⋯" → Redeploy · `vercel redeploy <url>` (CLI is logged in) · push any commit (empty is fine).
- Required env (Production + Preview): `GEMINI_API_KEY`, `OPENAI_API_KEY`, `BLOB_STORE_ID` (auto-managed by the store connection). Optional: `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE`, `OPENAI_SUMMARY_MODEL`.

## Key files

| File | Role |
|---|---|
| `server/app.ts` | Routes: health, bootstrap, both live-session mints, reflect |
| `server/lib/prompts.ts` | `buildTutorInstructions()` — shared prompt + engine-gated blocks (OpenAI accent, Gemini dosage) + CONTINUITY/opening blocks |
| `server/lib/memoryStore.ts` | Blob/file persistence, normalization, reflection merging |
| `server/lib/reflection.ts` | Post-lesson analysis, strict JSON schema |
| `client/src/hooks/useOpenAiRealtimeSession.ts` | WebRTC session (OpenAI) |
| `client/src/hooks/useRealtimeTutorSession.ts` | WebSocket session (Gemini) — do not touch lightly, it works |
| `client/src/App.tsx` | All UI state; dual-hook mount + engine toggle |

## Known issues / notes

- Gemini path still sends the raw API key to the browser (pre-existing; acceptable for single-user).
- `.env` contains real keys and is gitignored — never commit it. `ai_studio_code (4).html` is the working Gemini reference (do not delete); `public/audio-worklets/` is unused scaffolding.
- Gemini hook uses deprecated `ScriptProcessorNode` (works fine; worklets are the eventual fix).
- No test suite. Verification is: `npm run build`, `/api/health`, and live voice sessions.
- `npm audit` shows pre-existing vulnerabilities in the dep tree (not from this branch's work).

## Where things stand / next steps

1. **In testing:** latest tuning round (Gemini dosage, OpenAI eagerness + accent v2) awaits Wayne's verdict — judge engines on both latency *and* pedagogy.
2. **When satisfied:** merge PR #2 → production gets both engines + durable memory. (Confirm the Blob store connection covers Production — it does — and that's it.)
3. **Possible later:** try `gpt-realtime-2.1-mini` / `cedar`; wire up AudioWorklets; surface curriculum/journey/plan in the UI (currently server-side only); Gemini ephemeral tokens if Google's SDK matures.
