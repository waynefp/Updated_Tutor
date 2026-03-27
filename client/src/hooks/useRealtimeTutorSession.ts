import { useCallback, useEffect, useRef, useState } from "react";
import { createRealtimeAnswer } from "../lib/api";
import type {
  LessonTurn,
  RealtimeEventLogItem,
  SessionCapture,
  SessionStatus
} from "../types";

type StartSessionInput = {
  deviceId?: string;
  focus: string;
  presetLabel: string;
};

type RealtimeServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  response?: {
    status?: string;
  };
  error?: {
    message?: string;
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
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const lastStatsSignatureRef = useRef<string>("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelIntervalRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<RealtimeEventLogItem[]>([]);
  const [liveUserCaption, setLiveUserCaption] = useState("");
  const [liveTutorCaption, setLiveTutorCaption] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState<LessonTurn[]>([]);

  const cleanup = useCallback(() => {
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    if (levelIntervalRef.current) {
      window.clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    lastStatsSignatureRef.current = "";
    speechDetectedRef.current = false;
    setMicLevel(0);

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    peerRef.current?.close();
    peerRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

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

  const wireTrackDebugging = useCallback(
    (track: MediaStreamTrack) => {
      appendEvent(
        "client.mic.track",
        `Microphone track ${track.readyState} (${track.enabled ? "enabled" : "disabled"}).`
      );

      track.addEventListener("mute", () => {
        appendEvent("client.mic.mute", "Microphone track reported mute.");
      });
      track.addEventListener("unmute", () => {
        appendEvent("client.mic.unmute", "Microphone track reported unmute.");
      });
      track.addEventListener("ended", () => {
        appendEvent("client.mic.ended", "Microphone track ended.");
      });
    },
    [appendEvent]
  );

  const promptReply = useCallback(() => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") {
      appendEvent("client.prompt_reply.skipped", "Data channel is not open.");
      return;
    }

    dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"]
        }
      })
    );
    appendEvent("client.response.create", "Manual tutor reply requested.");
  }, [appendEvent]);

  const commitSpeechTurn = useCallback(() => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") {
      appendEvent("client.commit.skipped", "Data channel is not open.");
      return;
    }

    dataChannel.send(
      JSON.stringify({
        type: "input_audio_buffer.commit"
      })
    );
    appendEvent("client.input_audio_buffer.commit", "Manual audio commit requested.");

    dataChannel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"]
        }
      })
    );
    appendEvent("client.response.create", "Tutor reply requested after manual commit.");
  }, [appendEvent]);

  const startTransportDiagnostics = useCallback(
    (peerConnection: RTCPeerConnection) => {
      if (statsIntervalRef.current) {
        window.clearInterval(statsIntervalRef.current);
      }

      statsIntervalRef.current = window.setInterval(async () => {
        try {
          const stats = await peerConnection.getStats();
          let outboundAudioReport = "";

          stats.forEach((report) => {
            if (report.type === "outbound-rtp" && report.kind === "audio") {
              const packetsSent =
                typeof report.packetsSent === "number" ? report.packetsSent : 0;
              const bytesSent =
                typeof report.bytesSent === "number" ? report.bytesSent : 0;
              outboundAudioReport = `packets=${packetsSent} bytes=${bytesSent}`;
            }
          });

          if (!outboundAudioReport || outboundAudioReport === lastStatsSignatureRef.current) {
            return;
          }

          lastStatsSignatureRef.current = outboundAudioReport;
          appendEvent("client.stats.audio_out", outboundAudioReport);
        } catch (statsError) {
          appendEvent(
            "client.stats.error",
            statsError instanceof Error ? statsError.message : "Unable to read WebRTC stats."
          );
        }
      }, 2000);
    },
    [appendEvent]
  );

  const startMicrophoneDiagnostics = useCallback(
    async (stream: MediaStream) => {
      if (levelIntervalRef.current) {
        window.clearInterval(levelIntervalRef.current);
      }

      const audioContext = new AudioContext();
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const samples = new Uint8Array(analyser.fftSize);
      levelIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current) {
          return;
        }

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
          appendEvent("client.mic.activity", `Speech detected locally (level=${level.toFixed(2)}).`);
        } else if (!isSpeaking && speechDetectedRef.current) {
          speechDetectedRef.current = false;
          appendEvent("client.mic.silence", "Local mic level returned to silence.");
        }
      }, 250);
    },
    [appendEvent]
  );

  const handleServerEvent = useCallback((event: RealtimeServerEvent) => {
    let detail = "";
    if (event.transcript) {
      detail = event.transcript;
    } else if (event.delta) {
      detail = event.delta;
    } else if (event.error?.message) {
      detail = event.error.message;
    } else if (event.response?.status) {
      detail = event.response.status;
    }
    appendEvent(event.type, detail);

    switch (event.type) {
      case "session.created":
      case "session.updated":
        setStatus("ready");
        break;
      case "input_audio_buffer.speech_started":
        setStatus("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("ready");
        break;
      case "response.created":
        setStatus("speaking");
        break;
      case "response.done":
        setStatus(event.response?.status === "failed" ? "error" : "ready");
        break;
      case "conversation.item.input_audio_transcription.delta":
        setLiveUserCaption((previous) => previous + (event.delta ?? ""));
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          setTranscript((previous) => [...previous, buildTurn("you", event.transcript ?? "")]);
        }
        setLiveUserCaption("");
        break;
      case "response.output_audio_transcript.delta":
        setLiveTutorCaption((previous) => previous + (event.delta ?? ""));
        break;
      case "response.output_audio_transcript.done":
        if (event.transcript) {
          setTranscript((previous) => [
            ...previous,
            buildTurn("tutor", event.transcript ?? "")
          ]);
        }
        setLiveTutorCaption("");
        break;
      case "error":
        setStatus("error");
        setError(event.error?.message ?? "The realtime session reported an error.");
        break;
      default:
        break;
    }
  }, []);

  const startSession = useCallback(
    async (input: StartSessionInput) => {
      cleanup();
      setError(null);
      setEventLog([]);
      setLiveUserCaption("");
      setLiveTutorCaption("");
      setTranscript([]);
      setStatus("connecting");
      appendEvent("client.session.start", `Starting session for ${input.presetLabel}.`);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            deviceId: input.deviceId ? { exact: input.deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true
          }
        });

        const activeTrack = stream.getAudioTracks()[0];
        if (activeTrack?.label) {
          appendEvent("client.mic.selected", `Using input: ${activeTrack.label}`);
        }

        const peerConnection = new RTCPeerConnection();
        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;

        remoteAudioRef.current = remoteAudio;
        localStreamRef.current = stream;
        peerRef.current = peerConnection;
        startedAtRef.current = new Date().toISOString();

        stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
        stream.getAudioTracks().forEach(wireTrackDebugging);
        await startMicrophoneDiagnostics(stream);

        peerConnection.addEventListener("connectionstatechange", () => {
          appendEvent(
            "client.peer.connection_state",
            peerConnection.connectionState || "unknown"
          );
        });
        peerConnection.addEventListener("iceconnectionstatechange", () => {
          appendEvent(
            "client.peer.ice_connection_state",
            peerConnection.iceConnectionState || "unknown"
          );
        });
        peerConnection.addEventListener("icegatheringstatechange", () => {
          appendEvent(
            "client.peer.ice_gathering_state",
            peerConnection.iceGatheringState || "unknown"
          );
        });
        peerConnection.addEventListener("signalingstatechange", () => {
          appendEvent(
            "client.peer.signaling_state",
            peerConnection.signalingState || "unknown"
          );
        });
        peerConnection.addEventListener("icecandidateerror", () => {
          appendEvent(
            "client.peer.ice_candidate_error",
            "ICE candidate gathering reported an error."
          );
        });
        startTransportDiagnostics(peerConnection);

        peerConnection.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0];
          appendEvent("client.audio.track", "Remote tutor audio track attached.");
        };
        remoteAudio.addEventListener("play", () => {
          appendEvent("client.audio.play", "Tutor audio playback started.");
        });
        remoteAudio.addEventListener("playing", () => {
          appendEvent("client.audio.playing", "Tutor audio is playing.");
        });
        remoteAudio.addEventListener("pause", () => {
          appendEvent("client.audio.pause", "Tutor audio playback paused.");
        });
        remoteAudio.addEventListener("ended", () => {
          appendEvent("client.audio.ended", "Tutor audio playback ended.");
        });
        remoteAudio.addEventListener("error", () => {
          appendEvent("client.audio.error", "Tutor audio element reported an error.");
        });

        const dataChannel = peerConnection.createDataChannel("oai-events");
        dataChannelRef.current = dataChannel;
        dataChannel.addEventListener("open", () => {
          setStatus("ready");
          appendEvent("client.channel.open", "Realtime data channel connected.");
          dataChannel.send(
            JSON.stringify({
              type: "response.create",
              response: {
                output_modalities: ["audio"],
                instructions: [
                  `Focus this session on ${input.focus}.`,
                  "Do not give a welcome speech or announce the lesson.",
                  "Open naturally, briefly, and supportively.",
                  "Assume the learner is an early beginner and lean toward English at the start.",
                  "Use at most one tiny Italian phrase or one very easy Italian question in the first turn.",
                  "Keep the first reply under two short sentences."
                ].join(" ")
              }
            })
          );
        });
        dataChannel.addEventListener("message", (messageEvent) => {
          handleServerEvent(JSON.parse(messageEvent.data) as RealtimeServerEvent);
        });
        dataChannel.addEventListener("close", () => {
          appendEvent("client.channel.closed", "Realtime data channel closed.");
        });
        dataChannel.addEventListener("error", () => {
          appendEvent("client.channel.error", "Realtime data channel reported an error.");
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const answerSdp = await createRealtimeAnswer({
          offerSdp: offer.sdp ?? "",
          focus: input.focus,
          presetLabel: input.presetLabel
        });

        await peerConnection.setRemoteDescription({
          type: "answer",
          sdp: answerSdp
        });
      } catch (sessionError) {
        cleanup();
        setStatus("error");
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "We could not start the realtime lesson."
        );
        appendEvent(
          "client.session.error",
          sessionError instanceof Error ? sessionError.message : "Unknown session error."
        );
      }
    },
    [
      appendEvent,
      cleanup,
      handleServerEvent,
      startMicrophoneDiagnostics,
      startTransportDiagnostics,
      wireTrackDebugging
    ]
  );

  const endSession = useCallback(async (): Promise<SessionCapture | null> => {
    const startedAt = startedAtRef.current;
    const endedAt = new Date().toISOString();

    cleanup();
    setStatus("idle");
    setLiveUserCaption("");
    setLiveTutorCaption("");
    startedAtRef.current = null;

    if (!startedAt) {
      return null;
    }

    return {
      startedAt,
      endedAt,
      turns: transcript
    };
  }, [cleanup, transcript]);

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
