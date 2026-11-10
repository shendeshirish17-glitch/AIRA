import { isLangCode } from "@/aira/stations"
import { cleanText, errorResponse, rateLimit } from "@/lib/aira-server/http"
import { buildMusicQuery, searchMusic } from "@/lib/aira-server/music"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const limited = rateLimit(request, "music", 30)
  if (limited) return limited
  try {
    const url = new URL(request.url)
    const lang = url.searchParams.get("lang")
    const query = buildMusicQuery(
      cleanText(url.searchParams.get("q"), 120),
      url.searchParams.get("station") ?? "hinglish",
      url.searchParams.get("vibe") ?? "morning",
    )
    return Response.json(
      await searchMusic(
        query,
        isLangCode(lang) ? lang : "hi-en",
        request.signal,
      ),
    )
  } catch (err) {
    return errorResponse(err, "music")
  }
}
