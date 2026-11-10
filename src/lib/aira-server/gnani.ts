// Gnani speech APIs (verified against https://docs.gnani.ai):
//   Prisma v2.5 STT REST: POST {base}/stt/v3                multipart: audio_file, language_code, format
//   Timbre TTS REST:      POST {base}/api/v1/tts/inference  JSON in, binary audio out
// Both authenticate with the X-API-Key-ID header.
import type { LangCode, StationId } from "@/aira/stations"
import { serverConfig } from "./config"
import { UpstreamError, fetchWithTimeout, upstreamStatusError } from "./http"

function requireKey() {
  const { apiKey, baseUrl, ttsModel } = serverConfig().gnani
  if (!apiKey)
    throw new UpstreamError("not_configured", "GNANI_API_KEY is not set.", 503)
  return { apiKey, baseUrl, ttsModel }
}

export const PRISMA_LANGS = new Set([
  "hi-IN",
  "en-IN",
  "ta-IN",
  "te-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "pa-IN",
  "bn-IN",
  "gu-IN",
])

export async function prismaTranscribe(
  audio: Blob,
  languageCode: string,
  signal?: AbortSignal,
): Promise<string> {
  const { apiKey, baseUrl } = requireKey()
  const form = new FormData()
  form.append("audio_file", audio, "utterance.wav")
  form.append("language_code", languageCode)
  form.append("format", "transcribe")
  const res = await fetchWithTimeout(
    `${baseUrl}/stt/v3`,
    {
      method: "POST",
      headers: { "X-API-Key-ID": apiKey },
      body: form,
      signal,
      timeoutMs: 20_000,
    },
    "Gnani Prisma",
  )
  if (!res.ok) throw upstreamStatusError("Gnani Prisma", res.status)
  const data = (await res.json()) as { success?: boolean; transcript?: string }
  if (data.success === false)
    throw new UpstreamError(
      "upstream",
      "Gnani Prisma could not transcribe the audio.",
    )
  return typeof data.transcript === "string" ? data.transcript.trim() : ""
}

// Timbre v3.0 voices speak all 10 languages, so each RJ keeps one gender-matched
// voice everywhere. v2.5 voices have one preferred language each.
// Override per station with TIMBRE_VOICE_TAMIL / TIMBRE_VOICE_HINGLISH / TIMBRE_VOICE_MARATHI.
const DEFAULT_VOICES: Record<string, Record<StationId, string>> = {
  "timbre-v3.0": { hinglish: "Devansh", marathi: "Lakshmi", tamil: "Riyaa" },
  "timbre-v2.5": { hinglish: "Vikrant", marathi: "Zahira", tamil: "Noopur" },
}

function pickVoice(model: string, stationId: StationId): string {
  const override =
    process.env[`TIMBRE_VOICE_${stationId.toUpperCase()}`]?.trim()
  if (override) return override
  return (DEFAULT_VOICES[model] ?? DEFAULT_VOICES["timbre-v3.0"])[stationId]
}

export async function timbreSynthesize(
  text: string,
  lang: LangCode,
  stationId: StationId,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const { apiKey, baseUrl, ttsModel } = requireKey()
  const body = {
    text,
    voice: pickVoice(ttsModel, stationId),
    model: ttsModel,
    // Every AIRa language code, including hi-en for Hinglish, is a documented Timbre value.
    language: lang,
    speed: 1.0,
    audio_config: {
      sample_rate: 24000,
      num_channels: 1,
      container: "mp3",
      bitrate: "64k",
    },
  }
  const res = await fetchWithTimeout(
    `${baseUrl}/api/v1/tts/inference`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key-ID": apiKey },
      body: JSON.stringify(body),
      signal,
      timeoutMs: 25_000,
    },
    "Gnani Timbre",
  )
  if (!res.ok) throw upstreamStatusError("Gnani Timbre", res.status)
  return res.arrayBuffer()
}
