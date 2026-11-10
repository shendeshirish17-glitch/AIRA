import { isLangCode, isStationId } from "@/aira/stations"
import { timbreSynthesize } from "@/lib/aira-server/gnani"
import {
  cleanText,
  errorResponse,
  jsonError,
  rateLimit,
  readJson,
} from "@/lib/aira-server/http"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const limited = rateLimit(request, "tts", 50)
  if (limited) return limited
  try {
    const body = await readJson<{
      text?: unknown
      lang?: unknown
      stationId?: unknown
    }>(request, 8000)
    const text = cleanText(body.text, 900)
    if (!text) return jsonError("bad_text", "Text is required.", 400)
    if (!isLangCode(body.lang))
      return jsonError("bad_lang", "Unsupported language.", 400)
    const stationId = isStationId(body.stationId) ? body.stationId : "hinglish"
    const audio = await timbreSynthesize(
      text,
      body.lang,
      stationId,
      request.signal,
    )
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    })
  } catch (err) {
    return errorResponse(err, "tts")
  }
}
