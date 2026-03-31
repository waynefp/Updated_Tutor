# Parola Viva

Parola Viva is a speaking-first Italian tutor designed around live voice sessions.
The app pairs a React front end with a lightweight Express server that:

- starts low-latency Gemini Live API voice sessions
- stores a persistent learner memory for one initial user
- reflects on each session so the next lesson builds on the last one

## What is included

- voice-first session UI with a live transcript rail
- persistent tutor memory in `server/data/default-user.json`
- contemporary Italy visual direction with local SVG artwork
- automatic lesson reflection and vocabulary capture after each session

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and add your `GEMINI_API_KEY` for live sessions and `OPENAI_API_KEY` for lesson reflections.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173)

## Realtime notes

- The browser connects directly to Gemini Live over WebSockets.
- The server issues a short-lived ephemeral token through `/api/live/session`, so the Gemini API key stays server-side.
- Tutor instructions are assembled from saved learner memory before the session starts.
- The default live model in this branch is `gemini-3.1-flash-live-preview`.
- Google’s current Live API docs note that affective dialog and proactive audio are not supported in Gemini 3.1 Flash Live, so this branch does not enable those settings.

## Memory notes

- Session memory is stored locally in JSON for now because you only need one learner profile initially.
- Each completed session is summarized through the OpenAI Responses API and saved back into the learner profile.
- This keeps the next lesson grounded in previous vocabulary, confidence notes, and correction priorities.
