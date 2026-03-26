import { useCallback, useEffect, useRef, useState } from "react";
import { createRealtimeAnswer } from "../lib/api";
import type { LessonTurn, SessionCapture, SessionStatus } from "../types";

type StartSessionInput = {
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

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveUserCaption, setLiveUserCaption] = useState("");
  const [liveTutorCaption, setLiveTutorCaption] = useState("");
  const [transcript, setTranscript] = useState<LessonTurn[]>([]);

  const cleanup = useCallback(() => {
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

  const handleServerEvent = useCallback((event: RealtimeServerEvent) => {
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
    async ({ focus, presetLabel }: StartSessionInput) => {
      cleanup();
      setError(null);
      setLiveUserCaption("");
      setLiveTutorCaption("");
      setTranscript([]);
      setStatus("connecting");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        const peerConnection = new RTCPeerConnection();
        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;

        remoteAudioRef.current = remoteAudio;
        localStreamRef.current = stream;
        peerRef.current = peerConnection;
        startedAtRef.current = new Date().toISOString();

        stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

        peerConnection.ontrack = (event) => {
          remoteAudio.srcObject = event.streams[0];
        };

        const dataChannel = peerConnection.createDataChannel("oai-events");
        dataChannelRef.current = dataChannel;
        dataChannel.addEventListener("open", () => {
          setStatus("ready");
          dataChannel.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `Open the lesson with a warm spoken welcome. Focus the session on ${focus}. Keep your first response under three sentences and finish with one easy question in Italian.`
                  }
                ]
              }
            })
          );
          dataChannel.send(
            JSON.stringify({
              type: "response.create",
              response: {
                output_modalities: ["audio"]
              }
            })
          );
        });
        dataChannel.addEventListener("message", (messageEvent) => {
          handleServerEvent(JSON.parse(messageEvent.data) as RealtimeServerEvent);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const answerSdp = await createRealtimeAnswer({
          offerSdp: offer.sdp ?? "",
          focus,
          presetLabel
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
      }
    },
    [cleanup, handleServerEvent]
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
    endSession,
    error,
    liveTutorCaption,
    liveUserCaption,
    startSession,
    status,
    transcript
  };
}
