import { useCallback, useEffect, useRef, useState } from "react";
import { createGptLiveSession } from "../lib/api";
import { createReplyTimer } from "../lib/replyTimer";
import type {
  LessonTurn,
  RealtimeEventLogItem,
  SessionCapture,
  SessionStatus
} from "../types";

// GPT-Live (gpt-live-1) over WebRTC. Same interface as the other engine hooks,
// so reflection and the UI work unchanged. Differences from gpt-realtime:
// - the server creates the session from our SDP offer (no key in the browser)
// - output audio is a continuous stream, so "tutor speaking" is detected from
//   the remote audio level rather than from events
// - there is no "response done" event, so transcript turns are assembled from
//   caption fragments (speaker change or a quiet gap closes a turn)

type StartSessionInput = {
  deviceId?: string;
  focus: string;
  presetLabel: string;
};

type GptLiveEvent = {
  type?: string;
  delta?: string;
  reason?: string;
  usage?: { seconds?: number };
  session?: { id?: string };
  error?: { type?: string; code?: string; message?: string };
};

type Speaker = LessonTurn["speaker"];

const OPENER_TEXT =
  "The lesson is starting now. Speak first: open the lesson the way your instructions describe, keep it short, then listen.";
// A caption turn closes after this long without a new fragment.
const TURN_QUIET_MS = 2500;
// Same 0..1 scale as the mic meter.
const MIC_SPEECH_LEVEL = 0.09;
const TUTOR_VOICE_LEVEL = 0.06;
// Remote level must stay low this many 250ms polls before the tutor counts as done.
const TUTOR_SILENT_POLLS = 3;
const USD_PER_MINUTE = 0.05;

const buildTurn = (speaker: Speaker, text: string): LessonTurn => ({
  id: crypto.randomUUID(),
  speaker,
  text,
  timestamp: new Date().toISOString()
});

function readLevel(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>) {
  analyser.getByteTimeDomainData(samples);
  let sumSquares = 0;
  for (const value of samples) {
    const normalized = (value - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSquares / samples.length) * 8);
}

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", onState);
      reject(new Error("Timed out while gathering network candidates."));
    }, 10_000);
    function onState() {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }
    peer.addEventListener("icegatheringstatechange", onState);
  });
}

export function useGptLiveSession() {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const tutorAnalyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<number | null>(null);
  const micSpeakingRef = useRef(false);
  const tutorSpeakingRef = useRef(false);
  const tutorSilentPollsRef = useRef(0);
  const startedAtRef = useRef<string | null>(null);
  const currentStatusRef = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<LessonTurn[]>([]);
  const sessionActiveRef = useRef(false);
  const closingRef = useRef(false);
  const closedResolverRef = useRef<(() => void) | null>(null);
  const captionSpeakerRef = useRef<Speaker | null>(null);
  const captionTextRef = useRef("");
  const captionTimerRef = useRef<number | null>(null);
  const replyTimerRef = useRef(createReplyTimer());

  const [replyTimesMs, setReplyTimesMs] = useState<number[]>([]);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<RealtimeEventLogItem[]>([]);
  const [liveUserCaption, setLiveUserCaption] = useState("");
  const [liveTutorCaption, setLiveTutorCaption] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState<LessonTurn[]>([]);

  const updateStatus = useCallback((nextStatus: SessionStatus) => {
    currentStatusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const appendEvent = useCallback((type: string, detail: string) => {
    setEventLog((previous) =>
      [
        { id: crypto.randomUUID(), type, detail, timestamp: new Date().toISOString() },
        ...previous
      ].slice(0, 24)
    );
  }, []);

  // Consecutive fragments from one speaker belong to one turn, even when a
  // short interjection from the other side split them.
  const appendTranscriptTurn = useCallback((speaker: Speaker, text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    const previous = transcriptRef.current;
    const last = previous[previous.length - 1];
    const nextTranscript =
      last && last.speaker === speaker
        ? [...previous.slice(0, -1), { ...last, text: `${last.text} ${normalizedText}` }]
        : [...previous, buildTurn(speaker, normalizedText)];
    transcriptRef.current = nextTranscript;
    setTranscript(nextTranscript);
  }, []);

  const commitCaption = useCallback(() => {
    if (captionTimerRef.current) {
      window.clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    const speaker = captionSpeakerRef.current;
    const text = captionTextRef.current;
    captionSpeakerRef.current = null;
    captionTextRef.current = "";
    if (!speaker) return;
    if (speaker === "you") setLiveUserCaption("");
    else setLiveTutorCaption("");
    appendTranscriptTurn(speaker, text);
  }, [appendTranscriptTurn]);

  const handleFragment = useCallback(
    (speaker: Speaker, delta: string) => {
      if (captionSpeakerRef.current && captionSpeakerRef.current !== speaker) {
        commitCaption();
      }
      captionSpeakerRef.current = speaker;
      captionTextRef.current += delta;
      const text = captionTextRef.current.trim();
      if (speaker === "you") setLiveUserCaption(text);
      else setLiveTutorCaption(text);

      if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
      captionTimerRef.current = window.setTimeout(commitCaption, TURN_QUIET_MS);
    },
    [commitCaption]
  );

  const stopAudioResources = useCallback(() => {
    if (levelIntervalRef.current) {
      window.clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    micSpeakingRef.current = false;
    tutorSpeakingRef.current = false;
    tutorSilentPollsRef.current = 0;
    setMicLevel(0);

    micAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    tutorAnalyserRef.current?.disconnect();
    tutorAnalyserRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (meterContextRef.current) {
      void meterContextRef.current.close();
      meterContextRef.current = null;
    }

    const audioElement = audioElementRef.current;
    audioElementRef.current = null;
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
      audioElement.remove();
    }
  }, []);

  const cleanup = useCallback(() => {
    sessionActiveRef.current = false;
    if (captionTimerRef.current) {
      window.clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }

    const dataChannel = dataChannelRef.current;
    dataChannelRef.current = null;
    if (dataChannel && dataChannel.readyState !== "closed") {
      dataChannel.close();
    }

    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      peer.close();
    }

    stopAudioResources();
    captionSpeakerRef.current = null;
    captionTextRef.current = "";
  }, [stopAudioResources]);

  useEffect(() => cleanup, [cleanup]);

  // One 250ms poll drives the mic meter, tutor-speaking detection and reply timing.
  const startLevelMonitor = useCallback(() => {
    if (levelIntervalRef.current) window.clearInterval(levelIntervalRef.current);
    const micSamples = new Uint8Array(2048);
    const tutorSamples = new Uint8Array(2048);

    levelIntervalRef.current = window.setInterval(() => {
      const micAnalyser = micAnalyserRef.current;
      if (micAnalyser) {
        const level = readLevel(micAnalyser, micSamples);
        setMicLevel(level);
        const isSpeaking = level > MIC_SPEECH_LEVEL;
        if (isSpeaking && !micSpeakingRef.current) {
          micSpeakingRef.current = true;
          replyTimerRef.current.speechStarted();
          if (currentStatusRef.current === "ready") updateStatus("listening");
        } else if (!isSpeaking && micSpeakingRef.current) {
          micSpeakingRef.current = false;
          replyTimerRef.current.speechStopped();
          if (currentStatusRef.current === "listening") updateStatus("ready");
        }
      }

      const tutorAnalyser = tutorAnalyserRef.current;
      if (tutorAnalyser && sessionActiveRef.current) {
        const tutorLevel = readLevel(tutorAnalyser, tutorSamples);
        if (tutorLevel > TUTOR_VOICE_LEVEL) {
          tutorSilentPollsRef.current = 0;
          if (!tutorSpeakingRef.current) {
            tutorSpeakingRef.current = true;
            const replyMs = replyTimerRef.current.replyAudioStarted();
            if (replyMs !== null) {
              setReplyTimesMs((previous) => [...previous, replyMs]);
              appendEvent(
                "client.reply_time",
                `Tutor audio started ${replyMs} ms after you stopped speaking.`
              );
            }
            if (currentStatusRef.current !== "error") updateStatus("speaking");
          }
        } else if (tutorSpeakingRef.current) {
          tutorSilentPollsRef.current += 1;
          if (tutorSilentPollsRef.current >= TUTOR_SILENT_POLLS) {
            tutorSpeakingRef.current = false;
            if (currentStatusRef.current === "speaking") {
              updateStatus(micSpeakingRef.current ? "listening" : "ready");
            }
          }
        }
      }
    }, 250);
  }, [appendEvent, updateStatus]);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") return false;
    dataChannel.send(JSON.stringify(event));
    return true;
  }, []);

  const handleServerEvent = useCallback(
    (event: GptLiveEvent) => {
      switch (event.type) {
        case "session.started":
          sessionActiveRef.current = true;
          startedAtRef.current = new Date().toISOString();
          updateStatus("ready");
          appendEvent("server.session_started", `GPT-Live session ${event.session?.id ?? ""} started.`);
          sendEvent({
            type: "session.instructions.append",
            event_id: `opener_${crypto.randomUUID()}`,
            delegation_id: null,
            content: OPENER_TEXT
          });
          break;

        case "session.instructions.appended":
          appendEvent("server.opener", "Tutor asked to open the lesson.");
          break;

        case "session.input_transcript.delta":
          if (sessionActiveRef.current && event.delta) handleFragment("you", event.delta);
          break;

        case "session.output_transcript.delta":
          if (sessionActiveRef.current && event.delta) handleFragment("tutor", event.delta);
          break;

        case "session.usage.updated": {
          const seconds = event.usage?.seconds ?? 0;
          appendEvent(
            "server.usage",
            `Voice time ${seconds}s (about $${((seconds / 60) * USD_PER_MINUTE).toFixed(2)}).`
          );
          break;
        }

        case "session.closed": {
          const seconds = event.usage?.seconds;
          appendEvent(
            "server.session_closed",
            `Closed (${event.reason ?? "unknown"})${seconds !== undefined ? ` after ${seconds}s of voice time` : ""}.`
          );
          closedResolverRef.current?.();
          closedResolverRef.current = null;
          if (!closingRef.current && currentStatusRef.current !== "idle") {
            commitCaption();
            sessionActiveRef.current = false;
            stopAudioResources();
            updateStatus("error");
            setError(`The GPT-Live session ended: ${event.reason ?? "unknown reason"}.`);
          }
          break;
        }

        case "error": {
          const message =
            event.error?.message ?? event.error?.code ?? "Unknown GPT-Live error.";
          appendEvent("server.error", message);
          console.warn("[GPT-Live]", event.error);
          break;
        }

        default:
          if (event.type && event.type !== "session.output_audio.delta") {
            appendEvent("server.unknown", event.type);
          }
      }
    },
    [appendEvent, commitCaption, handleFragment, sendEvent, stopAudioResources, updateStatus]
  );

  const startSession = useCallback(
    async (input: StartSessionInput) => {
      cleanup();
      closingRef.current = false;
      setError(null);
      setEventLog([]);
      setLiveUserCaption("");
      setLiveTutorCaption("");
      transcriptRef.current = [];
      setTranscript([]);
      setReplyTimesMs([]);
      replyTimerRef.current.reset();
      updateStatus("connecting");
      appendEvent("client.session.start", `Starting GPT-Live session for ${input.presetLabel}.`);

      // Created synchronously in the Start-button gesture so mobile Safari
      // allows playback of the remote track.
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);
      audioElementRef.current = audioElement;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            deviceId: input.deviceId ? { exact: input.deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
        localStreamRef.current = stream;
        const activeTrack = stream.getAudioTracks()[0];
        if (activeTrack?.label) {
          appendEvent("client.mic.selected", `Using input: ${activeTrack.label}`);
        }

        const meterContext = new AudioContext();
        meterContextRef.current = meterContext;
        await meterContext.resume();
        const micAnalyser = meterContext.createAnalyser();
        micAnalyser.fftSize = 2048;
        meterContext.createMediaStreamSource(stream).connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;
        startLevelMonitor();

        const peer = new RTCPeerConnection();
        peerRef.current = peer;
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));

        peer.ontrack = (event) => {
          const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
          audioElement.srcObject = remoteStream;
          void audioElement.play().catch((playError) => {
            appendEvent("client.audio.blocked", `Playback blocked: ${String(playError)}`);
          });
          // Level meter on the tutor's audio (playback still goes through the element).
          const tutorAnalyser = meterContext.createAnalyser();
          tutorAnalyser.fftSize = 2048;
          meterContext.createMediaStreamSource(remoteStream).connect(tutorAnalyser);
          tutorAnalyserRef.current = tutorAnalyser;
        };

        peer.onconnectionstatechange = () => {
          const state = peer.connectionState;
          appendEvent("client.rtc.state", `Connection state: ${state}`);
          if (
            !closingRef.current &&
            (state === "failed" || state === "closed" || state === "disconnected") &&
            currentStatusRef.current !== "idle" &&
            currentStatusRef.current !== "error"
          ) {
            sessionActiveRef.current = false;
            stopAudioResources();
            updateStatus("error");
            setError(`GPT-Live connection ${state}.`);
          }
        };

        const dataChannel = peer.createDataChannel("oai-events");
        dataChannelRef.current = dataChannel;
        dataChannel.onmessage = (event) => {
          let message: GptLiveEvent;
          try {
            message = JSON.parse(event.data);
          } catch (parseError) {
            console.error("GPT-Live event parse error:", parseError);
            return;
          }
          handleServerEvent(message);
        };

        await peer.setLocalDescription(await peer.createOffer());
        await waitForIceGathering(peer);
        const offerSdp = peer.localDescription?.sdp;
        if (!offerSdp) throw new Error("The browser produced no connection offer.");

        const liveSession = await createGptLiveSession({
          focus: input.focus,
          presetLabel: input.presetLabel,
          sdp: offerSdp
        });
        appendEvent(
          "client.session.created",
          `Session created for ${liveSession.model} (${liveSession.voice}).`
        );
        await peer.setRemoteDescription({ type: "answer", sdp: liveSession.sdp });
      } catch (sessionError) {
        cleanup();
        updateStatus("error");
        const message =
          sessionError instanceof Error ? sessionError.message : "We could not start the GPT-Live lesson.";
        setError(message);
        appendEvent("client.session.error", message);
      }
    },
    [appendEvent, cleanup, handleServerEvent, startLevelMonitor, stopAudioResources, updateStatus]
  );

  const endSession = useCallback(async (): Promise<SessionCapture | null> => {
    const startedAt = startedAtRef.current;
    const endedAt = new Date().toISOString();

    commitCaption();
    closingRef.current = true;
    // Ask OpenAI to close so the session is finalized and billed exactly;
    // don't wait more than a couple of seconds for confirmation.
    if (sendEvent({ type: "session.close", event_id: `close_${crypto.randomUUID()}` })) {
      await new Promise<void>((resolve) => {
        closedResolverRef.current = resolve;
        window.setTimeout(resolve, 2000);
      });
    }
    closedResolverRef.current = null;

    cleanup();
    updateStatus("idle");
    setLiveUserCaption("");
    setLiveTutorCaption("");
    startedAtRef.current = null;

    if (!startedAt) return null;
    return { startedAt, endedAt, turns: transcriptRef.current };
  }, [cleanup, commitCaption, sendEvent, updateStatus]);

  // Kept for interface parity with the other engines; GPT-Live decides its own turns.
  const promptReply = useCallback(() => undefined, []);
  const commitSpeechTurn = useCallback(() => undefined, []);

  return {
    commitSpeechTurn,
    endSession,
    error,
    eventLog,
    liveTutorCaption,
    liveUserCaption,
    micLevel,
    promptReply,
    replyTimesMs,
    startSession,
    status,
    transcript
  };
}
