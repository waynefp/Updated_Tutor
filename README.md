# Parola Viva

Parola Viva is a speaking-first Italian tutor designed around live voice sessions.
The app pairs a React front end with a lightweight Express server that:

- starts low-latency WebRTC Realtime sessions with `gpt-realtime`
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

2. Copy `.env.example` to `.env` and add your `OPENAI_API_KEY`.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173)

## Realtime notes

- The browser uses WebRTC for the live call.
- The server exchanges the browser SDP offer for an answer through `POST /v1/realtime/calls`.
- Tutor instructions are assembled from saved learner memory before the session starts.

## Memory notes

- Session memory is stored locally in JSON for now because you only need one learner profile initially.
- Each completed session is summarized through the Responses API and saved back into the learner profile.
- This keeps the next lesson grounded in previous vocabulary, confidence notes, and correction priorities.
