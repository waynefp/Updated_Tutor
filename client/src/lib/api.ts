import type {
  BootstrapPayload,
  ReflectionPayload,
  SessionCapture
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function assertOk(response: Response) {
  if (response.ok) {
    return response;
  }

  const text = await response.text();
  throw new Error(text || "Request failed.");
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  const response = await assertOk(await fetch(`${API_BASE_URL}/api/bootstrap`));
  return response.json() as Promise<BootstrapPayload>;
}

export async function createRealtimeAnswer(input: {
  offerSdp: string;
  focus: string;
  presetLabel: string;
}): Promise<string> {
  const response = await assertOk(
    await fetch(`${API_BASE_URL}/api/realtime/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return response.text();
}

export async function reflectLesson(input: {
  focus: string;
  presetLabel: string;
  capture: SessionCapture;
}): Promise<ReflectionPayload> {
  const response = await assertOk(
    await fetch(`${API_BASE_URL}/api/lessons/reflect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    })
  );

  return response.json() as Promise<ReflectionPayload>;
}
