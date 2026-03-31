# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs client on :5173 + server on :8787 concurrently)
npm run dev

# Client only
npm run dev:client

# Server only (tsx watch)
npm run dev:server

# Production build (Vite client → dist/ + tsc server → server/dist/)
npm run build

# Production start
npm start
```

No test suite is currently configured.

## Environment Setup

Copy `.env.example` to `.env` and populate:

```
GEMINI_API_KEY=
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Callirrhoe
OPENAI_API_KEY=
OPENAI_SUMMARY_MODEL=gpt-4.1-mini
VITE_API_BASE_URL=http://localhost:8787
```

## Architecture

**Parola Viva** is a voice-first Italian tutor. The user speaks into the mic, audio streams bidirectionally over a WebSocket to Google's Gemini Live API, and after each session OpenAI reflects on the transcript and updates a persistent learner profile.

### Data Flow

1. Browser loads → `GET /api/bootstrap` returns app config, learner profile, session presets, culture scenes from `server/lib/prompts.ts` + `server/lib/memoryStore.ts`
2. User starts session → `POST /api/live/session` mints an ephemeral Gemini token (30min, 1-use) and builds the system prompt from learner memory + preset context via `server/lib/prompts.ts:buildTutorInstructions()`
3. Browser hook (`useRealtimeTutorSession`) opens a direct WebSocket to Gemini using that token — the server is NOT in the audio path
4. Audio streams as 16kHz PCM base64 in both directions; `client/src/lib/audio.ts` handles encoding/decoding
5. Session ends → `POST /api/lessons/reflect` sends the transcript + learner profile to OpenAI (Responses API, structured JSON) → reflection merges back into `server/data/default-user.json` (local) or `/tmp/parola-viva-memory.json` (Vercel)

### Key Files

| File | Responsibility |
|------|---------------|
| `server/app.ts` | Express routes: bootstrap, live/session, lessons/reflect |
| `server/lib/prompts.ts` | Session presets, culture scenes, `buildTutorInstructions()` |
| `server/lib/memoryStore.ts` | Read/write/merge learner profile JSON; dedup vocab & sessions |
| `server/lib/reflection.ts` | OpenAI Responses API call with strict JSON schema for lesson analysis |
| `server/lib/types.ts` | Server-side types (TutorMemory, SessionRecord, etc.) |
| `client/src/hooks/useRealtimeTutorSession.ts` | Gemini Live WebSocket session, AudioContext mic capture, PCM playback |
| `client/src/App.tsx` | Entire UI; all state lives here |
| `client/src/lib/api.ts` | Typed wrappers for the three API endpoints |
| `client/src/types.ts` | Shared client types |
| `api/index.ts` | Vercel serverless adapter (re-exports Express app) |

### TypeScript Configuration

Two separate tsconfig files:
- Root `tsconfig.json` — client (Vite/bundler module resolution, DOM libs)
- `server/tsconfig.json` — server (NodeNext module resolution, outputs to `server/dist/`)

### Learner Memory

The single user profile lives in `server/data/default-user.json` (dev) or `/tmp/parola-viva-memory.json` (Vercel). After each session, `applyReflection()` in `memoryStore.ts` merges the AI reflection: dedupes vocabulary by Italian word, keeps the 8 most recent sessions and 12 vocab items, and updates the profile fields.

### Gemini Live Integration

The client connects via raw WebSocket to `wss://generativelanguage.googleapis.com/ws/...?key=API_KEY`. The server returns the API key and config; the client sends a `setup` JSON message over the socket, then streams PCM audio bidirectionally. Audio uses `ScriptProcessorNode` at 16kHz with noise suppression/echo cancellation. Output playback is at 24kHz. Speech detection threshold is 0.09 RMS (see `startMicrophoneDiagnostics()`).

### Deployment

Vercel reads `api/index.ts` as the serverless function entry. The client build output (`dist/`) is served as static files. Memory writes go to `/tmp` on Vercel (ephemeral per instance — no multi-user or persistence guarantees in production without a database).
