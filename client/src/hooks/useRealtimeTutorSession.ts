import { useCallback, useEffect, useRef, useState } from "react";
import { arrayBufferToBase64, decodePcm16Base64 } from "../lib/audio";
import { createLiveSession } from "../lib/api";
import type {
  LessonTurn,
  RealtimeEventLogItem,
  SessionCapture,
  SessionStatus
} from "../types";

const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

type StartSessionInput = {
  deviceId?: string;
  focus: string;
  presetLabel: string;
};

type GeminiServerMessage = {
  setupComplete?: Record<string, never>;
  serverContent?: {
    generationComplete?: boolean;
    inputTranscription?: { text?: string };
    interrupted?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
        text?: string;
      }>;
    };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    waitingForInput?: boolean;
  };
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

export function useRealtimeTutorSession() {
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const startedAtRef = useRef<string | null>(null);
  const currentStatusRef = useRef<SessionStatus>("idle");
  const transcriptRef = useRef<LessonTurn[]>([]);
  const nextPlayTimeRef = useRef(0);
  const sessionActiveRef = useRef(false);
  const currentUserCaptionRef = useRef("");
  const currentTutorCaptionRef = useRef("");
  const committedUserCaptionRef = useRef("");
  const committedTutorCaptionRef = useRef("");

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

  const finalizeTurn = useCallback(() => {
    const userText = currentUserCaptionRef.current.trim();
    if (userText && userText !== committedUserCaptionRef.current) {
      committedUserCaptionRef.current = userText;
      appendTranscriptTurn("you", userText);
    }

    const tutorText = currentTutorCaptionRef.current.trim();
    if (tutorText && tutorText !== committedTutorCaptionRef.current) {
      committedTutorCaptionRef.current = tutorText;
      appendTranscriptTurn("tutor", tutorText);
    }

    currentUserCaptionRef.current = "";
    currentTutorCaptionRef.current = "";
    setLiveUserCaption("");
    setLiveTutorCaption("");
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

    processorRef.current?.disconnect();
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
    }
    processorRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    nextPlayTimeRef.current = 0;
  }, []);

  const cleanup = useCallback(() => {
    sessionActiveRef.current = false;

    const ws = socketRef.current;
    socketRef.current = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }

    stopAudioResources();
    currentUserCaptionRef.current = "";
    currentTutorCaptionRef.current = "";
    committedUserCaptionRef.current = "";
    committedTutorCaptionRef.current = "";
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

  const playAudioChunk = useCallback((base64Pcm: string) => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    const float32 = decodePcm16Base64(base64Pcm);
    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const currentTime = audioContext.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }

    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
  }, []);

  const initializeMic = useCallback(
    async (deviceId?: string) => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const ws = socketRef.current;
        if (!sessionActiveRef.current || !ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);

        const pcm = new Int16Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, input[index]));
          pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }

        // Send audio using the raw WebSocket format from working Gemini Live reference
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: arrayBufferToBase64(pcm.buffer)
              }
            }
          })
        );
      };

      source.connect(analyser);
      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      localStreamRef.current = stream;
      processorRef.current = processor;
      nextPlayTimeRef.current = audioContext.currentTime;

      const activeTrack = stream.getAudioTracks()[0];
      if (activeTrack?.label) {
        appendEvent("client.mic.selected", `Using input: ${activeTrack.label}`);
      }
      startMicrophoneDiagnostics(analyser);
      appendEvent("client.mic.ready", "Microphone stream connected to Gemini Live.");
    },
    [appendEvent, startMicrophoneDiagnostics]
  );

  const handleServerMessage = useCallback(
    (message: GeminiServerMessage) => {
      if (!sessionActiveRef.current) return;

      if (message.serverContent?.interrupted && audioContextRef.current) {
        appendEvent("server.interrupted", "Gemini interrupted the current response.");
        nextPlayTimeRef.current = audioContextRef.current.currentTime;
      }

      const userTranscript = message.serverContent?.inputTranscription?.text?.trim();
      if (userTranscript) {
        currentUserCaptionRef.current = userTranscript;
        setLiveUserCaption(userTranscript);
        appendEvent("server.input_transcription", userTranscript);
        updateStatus("listening");
      }

      const tutorTranscript =
        message.serverContent?.outputTranscription?.text?.trim();
      if (tutorTranscript) {
        currentTutorCaptionRef.current = tutorTranscript;
        setLiveTutorCaption(tutorTranscript);
        appendEvent("server.output_transcription", tutorTranscript);
        updateStatus("speaking");
      }

      for (const part of message.serverContent?.modelTurn?.parts ?? []) {
        if (part.text?.trim()) {
          currentTutorCaptionRef.current = part.text.trim();
          setLiveTutorCaption(part.text.trim());
          updateStatus("speaking");
        }

        if (part.inlineData?.data) {
          playAudioChunk(part.inlineData.data);
          updateStatus("speaking");
        }
      }

      if (
        message.serverContent?.turnComplete ||
        message.serverContent?.generationComplete ||
        message.serverContent?.waitingForInput
      ) {
        appendEvent("server.turn_complete", "Gemini completed a conversational turn.");
        finalizeTurn();
        if (currentStatusRef.current !== "error") {
          updateStatus("ready");
        }
      }
    },
    [appendEvent, finalizeTurn, playAudioChunk, updateStatus]
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
        `Starting Gemini Live session for ${input.presetLabel}.`
      );

      try {
        const liveSession = await createLiveSession({
          focus: input.focus,
          presetLabel: input.presetLabel
        });

        const ws = new WebSocket(
          `${GEMINI_WS_URL}?key=${liveSession.apiKey}`
        );
        socketRef.current = ws;

        ws.onopen = () => {
          appendEvent(
            "client.live.open",
            "WebSocket opened. Sending setup message..."
          );

          // Send setup message — matches the working Gemini Live HTML reference
          const setupMsg = {
            setup: {
              model: liveSession.model,
              systemInstruction: {
                parts: [{ text: liveSession.systemInstruction }]
              },
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: liveSession.voice
                    }
                  }
                }
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {}
            }
          };

          console.log("[Gemini Live] Setup message:", JSON.stringify(setupMsg, null, 2));
          ws.send(JSON.stringify(setupMsg));
        };

        ws.onmessage = async (event) => {
          let msg: GeminiServerMessage;
          try {
            if (event.data instanceof Blob) {
              msg = JSON.parse(await event.data.text());
            } else {
              msg = JSON.parse(event.data);
            }
          } catch (err) {
            console.error("Gemini parse error:", err);
            return;
          }

          if (msg.setupComplete) {
            appendEvent(
              "client.live.setup_complete",
              "Gemini accepted the live session setup."
            );
            sessionActiveRef.current = true;
            startedAtRef.current = new Date().toISOString();

            await initializeMic(input.deviceId);
            updateStatus("ready");
            appendEvent(
              "client.session.ready",
              "Mic active. Speak or wait for the tutor to begin."
            );
            return;
          }

          handleServerMessage(msg);
        };

        ws.onerror = () => {
          appendEvent("client.live.error", "WebSocket error (see close event for details).");
        };

        ws.onclose = (event) => {
          let reasonText = event.reason || "Connection dropped.";
          if (event.code === 403)
            reasonText = "403 Forbidden: Invalid API Key or region restriction.";
          if (event.code === 400)
            reasonText = "400 Bad Request: Setup format rejected.";
          if (event.code === 1011)
            reasonText = "1011 Internal Error: Google backend error.";
          if (event.code === 1008)
            reasonText = "1008 Policy: Model not found or not allowlisted.";

          const detail = `Session closed: ${reasonText} (code ${event.code})`;
          appendEvent("client.live.close", detail);
          console.warn("[Gemini Live]", detail);

          // Always clean up and surface the error, whether or not setup completed
          sessionActiveRef.current = false;
          stopAudioResources();

          // If we were still connecting or active, treat this as an error
          if (currentStatusRef.current !== "idle" && currentStatusRef.current !== "error") {
            updateStatus("error");
            setError(reasonText);
          }
        };
      } catch (sessionError) {
        cleanup();
        updateStatus("error");
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "We could not start the Gemini Live lesson."
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
      handleServerMessage,
      initializeMic,
      stopAudioResources,
      updateStatus
    ]
  );

  const endSession = useCallback(async (): Promise<SessionCapture | null> => {
    const startedAt = startedAtRef.current;
    const endedAt = new Date().toISOString();

    sessionActiveRef.current = false;
    finalizeTurn();
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
  }, [cleanup, finalizeTurn, updateStatus]);

  const promptReply = useCallback(() => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: "Continue the tutoring conversation with one short, natural spoken reply."
                }
              ]
            }
          ],
          turnComplete: true
        }
      })
    );
  }, []);

  const commitSpeechTurn = useCallback(() => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify({
        realtimeInput: {
          audioStreamEnd: true
        }
      })
    );
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
