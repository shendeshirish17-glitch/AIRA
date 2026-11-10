// Typed, cancellable wrappers around the /api/aira/* route handlers.
import type {
  ConverseRequest,
  ConverseResponse,
  MusicResponse,
  NewsResponse,
  NewsTopic,
  PodcastResponse,
  ProviderStatus,
} from "@/aira/protocol"
import {
  LANGUAGES,
  stationById,
  type LangCode,
  type NewsLang,
  type StationId,
  type VibeId,
} from "@/aira/stations"

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    if (init.signal?.aborted) throw err
    throw new ApiError("network", "Network error. Check your connection.", 0)
  }
  if (!res.ok) {
    let code = "http_error"
    let message = `Request failed (HTTP ${res.status}).`
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string }
      }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, message, res.status)
  }
  const type = res.headers.get("content-type") ?? ""
  return (
    type.includes("application/json") ? res.json() : res.arrayBuffer()
  ) as Promise<T>
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString()

export const api = {
  status: (signal?: AbortSignal) =>
    call<ProviderStatus>("/api/aira/status", { signal }),
  transcribe(audio: Blob, lang: string, signal?: AbortSignal) {
    const form = new FormData()
    form.append("audio", audio, "utterance.wav")
    form.append("lang", lang)
    return call<{ transcript: string }>("/api/aira/stt", {
      method: "POST",
      body: form,
      signal,
    })
  },
  converse: (req: ConverseRequest, signal?: AbortSignal) => {
    const { stationId, ...body } = req
    return call<ConverseResponse>("/api/aira/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        frequency: stationById(stationId).freq,
        language: LANGUAGES[req.lang].speech,
      }),
      signal,
    })
  },
  tts: (
    text: string,
    lang: LangCode,
    stationId: StationId,
    signal?: AbortSignal,
  ) =>
    call<ArrayBuffer>("/api/aira/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, stationId }),
      signal,
    }),
  music: (
    p: { q?: string; lang: LangCode; station: StationId; vibe: VibeId },
    signal?: AbortSignal,
  ) =>
    call<MusicResponse>(
      `/api/aira/music?${qs({ q: p.q, lang: p.lang, station: p.station, vibe: p.vibe })}`,
      { signal },
    ),
  podcasts: (p: { q?: string; station: StationId }, signal?: AbortSignal) =>
    call<PodcastResponse>(
      `/api/aira/podcasts?${qs({ q: p.q, station: p.station })}`,
      { signal },
    ),
  news: (
    p: { lang?: NewsLang; topic?: NewsTopic; station: StationId },
    signal?: AbortSignal,
  ) =>
    call<NewsResponse>(
      `/api/aira/news?${qs({ lang: p.lang, topic: p.topic, station: p.station })}`,
      { signal },
    ),
}

export const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === "AbortError"
