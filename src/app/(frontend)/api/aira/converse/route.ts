import type { ConverseRequest, HistoryTurn } from "@/aira/protocol"
import {
  LANGUAGES,
  STATIONS,
  isLangCode,
  isSpeechLangCode,
  isStationId,
  isVibeId,
  langFromSpeechCode,
  stationById,
} from "@/aira/stations"
import { converse } from "@/lib/aira-server/evon"
import {
  cleanText,
  errorResponse,
  jsonError,
  rateLimit,
  readJson,
} from "@/lib/aira-server/http"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const limited = rateLimit(request, "converse", 40)
  if (limited) return limited
  try {
    const parsed = await readJson<unknown>(request, 16_000)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return jsonError("bad_json", "Request body must be a JSON object.", 400)
    const body = parsed as Record<string, unknown>
    const text = cleanText(body.text, 500)
    if (!text) return jsonError("bad_text", "Text is required.", 400)
    if (body.stationId !== undefined && !isStationId(body.stationId))
      return jsonError("bad_station", "Station is not supported.", 400)
    if (body.vibeId !== undefined && !isVibeId(body.vibeId))
      return jsonError("bad_vibe", "Vibe is not supported.", 400)

    let frequencyStationId: ConverseRequest["stationId"] | undefined
    if (body.frequency !== undefined) {
      const frequency =
        typeof body.frequency === "number"
          ? body.frequency
          : typeof body.frequency === "string"
            ? Number(body.frequency)
            : Number.NaN
      frequencyStationId = STATIONS.find(
        (station) => station.freq === frequency,
      )?.id
      if (!frequencyStationId)
        return jsonError("bad_frequency", "Frequency is not supported.", 400)
    }

    if (
      isStationId(body.stationId) &&
      frequencyStationId &&
      body.stationId !== frequencyStationId
    )
      return jsonError(
        "bad_station",
        "Station and frequency do not match.",
        400,
      )

    const stationId = isStationId(body.stationId)
      ? body.stationId
      : (frequencyStationId ?? "hinglish")
    if (body.lang !== undefined && !isLangCode(body.lang))
      return jsonError("bad_language", "Reply language is not supported.", 400)

    const speechLanguage = body.language
    if (speechLanguage !== undefined && !isSpeechLangCode(speechLanguage))
      return jsonError("bad_language", "BCP-47 language is not supported.", 400)

    const lang = isLangCode(body.lang)
      ? body.lang
      : isSpeechLangCode(speechLanguage)
        ? langFromSpeechCode(speechLanguage, stationById(stationId).lang)
        : stationById(stationId).lang

    if (
      isSpeechLangCode(speechLanguage) &&
      LANGUAGES[lang].speech !== speechLanguage
    )
      return jsonError("bad_language", "Language fields do not match.", 400)

    const media = (body.media ?? {}) as Record<string, unknown>
    const history = Array.isArray(body.history) ? body.history : []
    const req: ConverseRequest = {
      text,
      stationId,
      lang,
      vibeId: isVibeId(body.vibeId) ? body.vibeId : "morning",
      media: {
        kind:
          media.kind === "music" || media.kind === "podcast"
            ? media.kind
            : "none",
        title: cleanText(media.title, 160) || undefined,
        playing: media.playing === true,
      },
      history: history
        .slice(-8)
        .map((h): HistoryTurn | null => {
          const turn = h as Record<string, unknown>
          const t = cleanText(turn?.text, 400)
          return t && (turn.role === "user" || turn.role === "assistant")
            ? { role: turn.role, text: t }
            : null
        })
        .filter((h): h is HistoryTurn => h !== null),
    }
    return Response.json(await converse(req, request.signal))
  } catch (err) {
    return errorResponse(err, "converse")
  }
}
