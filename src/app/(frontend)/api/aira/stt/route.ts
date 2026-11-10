import { PRISMA_LANGS, prismaTranscribe } from "@/lib/aira-server/gnani"
import { errorResponse, jsonError, rateLimit } from "@/lib/aira-server/http"

export const dynamic = "force-dynamic"

// 15 s of 16 kHz mono PCM16 is ~480 KB; leave headroom for headers.
const MAX_BYTES = 1_200_000

export async function POST(request: Request) {
  const limited = rateLimit(request, "stt", 40)
  if (limited) return limited
  try {
    const requestType = request.headers.get("content-type") ?? ""
    if (!/^multipart\/form-data\s*;.*\bboundary=/i.test(requestType))
      return jsonError(
        "bad_content_type",
        "Audio must be submitted as multipart form data with a boundary.",
        415,
      )
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 32_768)
      return jsonError("too_large", "Audio clip is too long.", 413)

    const form = await request.formData()
    const audio = form.get("audio")
    const lang = String(form.get("lang") ?? "")
    if (!(audio instanceof Blob) || audio.size < 1000)
      return jsonError("bad_audio", "Audio is missing or too short.", 400)
    if (audio.size > MAX_BYTES)
      return jsonError("too_large", "Audio clip is too long.", 413)
    if (!["audio/wav", "audio/wave", "audio/x-wav"].includes(audio.type))
      return jsonError(
        "bad_content_type",
        "Audio must be a WAV file.",
        415,
      )
    if (!PRISMA_LANGS.has(lang))
      return jsonError("bad_lang", "Unsupported language code.", 400)
    const transcript = await prismaTranscribe(audio, lang, request.signal)
    return Response.json({ transcript })
  } catch (err) {
    return errorResponse(err, "stt")
  }
}
