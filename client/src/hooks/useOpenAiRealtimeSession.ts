import { useCallback, useEffect, useRef, useState } from "react";
import { createOpenAiLiveSession } from "../lib/api";
import type {
  LessonTurn,
  RealtimeEventLogItem,
  SessionCapture,
  SessionStatus
} from "../types";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type StartSessionInput = {
  deviceId?: string;
  focus: string;
  presetLabel: string;
};

type OpenAiServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { type?: string; message?: string };
  response?: { status?: string };
};

const buildTurn = (
  speaker: LessonTurn["speaker"],
  text: string
): LessonTurn => ({
  id: crypto.randomUUID(),
  speaker,
  text,
  timestamp: new Date().toISOString()
});

export function useOpenAiRealtimeSession() {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const startedAtRef = useRef<string | null>(null);
  const currentStatusRef = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<LessonTurn[]>([]);
  const sessionActiveRef = useRef(false);
  const currentUserCaptionRef = useRef("");
  const currentTutorCaptionRef = useRef("");

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
        {
          id: crypto.randomUUID(),
          type,
          detail,
          timestamp: new Date().toISOString()
        },
        ...previous
      ].slice(0, 24)
    );
  }, []);

  const appendTranscriptTurn = useCallback(
    (speaker: LessonTurn["speaker"], text: string) => {
      const normalizedText = text.trim();
      if (!normalizedText) return;

      const nextTranscript = [
        ...transcriptRef.current,
        buildTurn(speaker, normalizedText)
      ];
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
    },
    []
  );

  const commitUserCaption = useCallback(() => {
    const userText = currentUserCaptionRef.current.trim();
    currentUserCaptionRef.current = "";
    setLiveUserCaption("");
    if (userText) {
      appendTranscriptTurn("you", userText);
    }
  }, [appendTranscriptTurn]);

  const commitTutorCaption = useCallback(() => {
    const tutorText = currentTutorCaptionRef.current.trim();
    currentTutorCaptionRef.current = "";
    setLiveTutorCaption("");
    if (tutorText) {
      appendTranscriptTurn("tutor", tutorText);
    }
  }, [appendTranscriptTurn]);

  const stopAudioResources = useCallback(() => {
    if (levelIntervalRef.current) {
      window.clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }

    speechDetectedRef.current = false;
    setMicLevel(0);

    analyserRef.current?.disconnect();
    analyserRef.current = null;

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
    currentUserCaptionRef.current = "";
    currentTutorCaptionRef.current = "";
  }, [stopAudioResources]);

  useEffect(() => cleanup, [cleanup]);

  const startMicrophoneDiagnostics = useCallback(
    (analyser: AnalyserNode) => {
      if (levelIntervalRef.current) {
        window.clearInterval(levelIntervalRef.current);
      }

      analyserRef.current = analyser;
      const samples = new Uint8Array(analyser.fftSize);
      levelIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (const value of samples) {
          const normalized = (value - 128) / 128;
          sumSquares += normalized * normalized;
        }

        const rms = Math.sqrt(sumSquares / samples.length);
        const level = Math.min(1, rms * 8);
        setMicLevel(level);

        const isSpeaking = level > 0.09;
        if (isSpeaking && !speechDetectedRef.current) {
          speechDetectedRef.current = true;
          if (currentStatusRef.current === "ready") {
            updateStatus("listening");
          }
          appendEvent(
            "client.mic.activity",
            `Speech detected locally (level=${level.toFixed(2)}).`
          );
        } else if (!isSpeaking && speechDetectedRef.current) {
          speechDetectedRef.current = false;
          if (currentStatusRef.current === "listening") {
            updateStatus("ready");
          }
          appendEvent("client.mic.silence", "Local mic level returned to silence.");
        }
      }, 250);
    },
    [appendEvent, updateStatus]
  );

  const handleServerEvent = useCallback(
    (event: OpenAiServerEvent) => {
      if (!sessionActiveRef.current) return;

      switch (event.type) {
        case "session.created":
        case "session.updated":
          appendEvent("server.session", `OpenAI ${event.type}.`);
          break;

        case "input_audio_buffer.speech_started":
          appendEvent("server.speech_started", "OpenAI detected you speaking.");
          // Barge-in: keep whatever the tutor managed to say in the transcript.
          commitTutorCaption();
          updateStatus("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          appendEvent("server.speech_stopped", "OpenAI detected you stopped.");
          break;

        case "conversation.item.input_audio_transcription.delta":
          if (event.delta) {
            currentUserCaptionRef.current += event.delta;
            setLiveUserCaption(currentUserCaptionRef.current);
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript?.trim()) {
            currentUserCaptionRef.current = event.transcript;
            setLiveUserCaption(event.transcript);
            appendEvent("server.input_transcription", event.transcript.trim());
          }
          // Commit immediately: user transcription can arrive after the
          // response has started, so waiting for turn end would misorder turns.
          commitUserCaption();
          break;

        case "response.created":
          currentTutorCaptionRef.current = "";
          setLiveTutorCaption("");
          break;

        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          if (event.delta) {
            currentTutorCaptionRef.current += event.delta;
            setLiveTutorCaption(currentTutorCaptionRef.current);
          }
          if (currentStatusRef.current !== "error") {
            updateStatus("speaking");
          }
          break;

        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (event.transcript?.trim()) {
            currentTutorCaptionRef.current = event.transcript;
            setLiveTutorCaption(event.transcript);
            appendEvent("server.output_transcription", event.transcript.trim());
          }
          break;

        case "output_audio_buffer.started":
          if (currentStatusRef.current !== "error") {
            updateStatus("speaking");
          }
          break;

        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          if (currentStatusRef.current === "speaking") {
            updateStatus("ready");
          }
          break;

        case "response.done":
          appendEvent("server.turn_complete", "OpenAI completed a conversational turn.");
          commitTutorCaption();
          if (currentStatusRef.current !== "error") {
            updateStatus("ready");
          }
          break;

        case "error": {
          const message = event.error?.message ?? "Unknown OpenAI realtime error.";
          appendEvent("server.error", message);
          console.warn("[OpenAI Realtime]", event.error);
          break;
        }

        default:
          if (event.type) {
            appendEvent("server.unknown", event.type);
          }
      }
    },
    [appendEvent, commitTutorCaption, commitUserCaption, updateStatus]
  );

  const startSession = useCallback(
    async (input: StartSessionInput) => {
      cleanup();
      setError(null);
      setEventLog([]);
      setLiveUserCaption("");
      setLiveTutorCaption("");
      transcriptRef.current = [];
      setTranscript([]);
      updateStatus("connecting");
      appendEvent(
        "client.session.start",
        `Starting OpenAI Realtime session for ${input.presetLabel}.`
      );

      // Created synchronously in the Start-button gesture so mobile Safari
      // allows playback of the remote track.
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);
      audioElementRef.current = audioElement;

      try {
        const liveSession = await createOpenAiLiveSession({
          focus: input.focus,
          presetLabel: input.presetLabel
        });
        appendEvent(
          "client.session.minted",
          `Ephemeral session created for ${liveSession.model} (${liveSession.voice}).`
        );

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

        const peer = new RTCPeerConnection();
        peerRef.current = peer;

        stream.getTracks().forEach((track) => peer.addTrack(track, stream));

        peer.ontrack = (event) => {
          audioElement.srcObject = event.streams[0];
          void audioElement.play().catch((playError) => {
            appendEvent(
              "client.audio.blocked",
              `Playback blocked: ${String(playError)}`
            );
          });
        };

        peer.onconnectionstatechange = () => {
          const state = peer.connectionState;
          appendEvent("client.rtc.state", `Connection state: ${state}`);

          if (
            (state === "failed" || state === "closed" || state === "disconnected") &&
            currentStatusRef.current !== "idle" &&
            currentStatusRef.current !== "error"
          ) {
            sessionActiveRef.current = false;
            stopAudioResources();
            updateStatus("error");
            setError(`Realtime connection ${state}.`);
          }
        };

        const dataChannel = peer.createDataChannel("oai-events");
        dataChannelRef.current = dataChannel;

        dataChannel.onopen = () => {
          sessionActiveRef.current = true;
          startedAtRef.current = new Date().toISOString();
          updateStatus("ready");
          appendEvent(
            "client.session.ready",
            "Mic active. Speak or wait for the tutor to begin."
          );
        };

        dataChannel.onmessage = (event) => {
          let message: OpenAiServerEvent;
          try {
            message = JSON.parse(event.data);
          } catch (parseError) {
            console.error("OpenAI event parse error:", parseError);
            return;
          }
          handleServerEvent(message);
        };

        // Mic level meter only — WebRTC consumes the raw track itself.
        const meterContext = new AudioContext();
        meterContextRef.current = meterContext;
        await meterContext.resume();
        const meterSource = meterContext.createMediaStreamSource(stream);
        const analyser = meterContext.createAnalyser();
        analyser.fftSize = 2048;
        meterSource.connect(analyser);
        startMicrophoneDiagnostics(analyser);

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        const sdpResponse = await fetch(
          `${OPENAI_CALLS_URL}?model=${encodeURIComponent(liveSession.model)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${liveSession.clientSecret}`,
              "Content-Type": "application/sdp"
            },
            body: offer.sdp
          }
        );

        if (!sdpResponse.ok) {
          const detail = await sdpResponse.text();
          throw new Error(
            `OpenAI rejected the realtime connection: ${detail || sdpResponse.status}`
          );
        }

        const answerSdp = await sdpResponse.text();
        await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
        appendEvent("client.rtc.connected", "WebRTC answer accepted by OpenAI.");
      } catch (sessionError) {
        cleanup();
        updateStatus("error");
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "We could not start the OpenAI realtime lesson."
        );
        appendEvent(
          "client.session.error",
          sessionError instanceof Error
            ? sessionError.message
            : "Unknown session error."
        );
      }
    },
    [
      appendEvent,
      cleanup,
      handleServerEvent,
      startMicrophoneDiagnostics,
      stopAudioResources,
      updateStatus
    ]
  );

  const endSession = useCallback(async (): Promise<SessionCapture | null> => {
    const startedAt = startedAtRef.current;
    const endedAt = new Date().toISOString();

    sessionActiveRef.current = false;
    commitUserCaption();
    commitTutorCaption();
    cleanup();
    updateStatus("idle");
    setLiveUserCaption("");
    setLiveTutorCaption("");
    startedAtRef.current = null;

    if (!startedAt) return null;

    return {
      startedAt,
      endedAt,
      turns: transcriptRef.current
    };
  }, [cleanup, commitTutorCaption, commitUserCaption, updateStatus]);

  const promptReply = useCallback(() => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") return;

    dataChannel.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const commitSpeechTurn = useCallback(() => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") return;

    dataChannel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  }, []);

  return {
    commitSpeechTurn,
    endSession,
    error,
    eventLog,
    liveTutorCaption,
    liveUserCaption,
    micLevel,
    promptReply,
    startSession,
    status,
    transcript
  };
}
