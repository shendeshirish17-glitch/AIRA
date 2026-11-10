import type { NewsTopic } from "@/aira/protocol"
import { isNewsLang, isStationId, stationById } from "@/aira/stations"
import { errorResponse, rateLimit } from "@/lib/aira-server/http"
import { getNews } from "@/lib/aira-server/news"

export const dynamic = "force-dynamic"

const TOPICS = new Set<NewsTopic>([
  "general",
  "world",
  "nation",
  "business",
  "technology",
  "entertainment",
  "sports",
  "science",
  "health",
])

export async function GET(request: Request) {
  const limited = rateLimit(request, "news", 20)
  if (limited) return limited
  try {
    const url = new URL(request.url)
    const stationParam = url.searchParams.get("station")
    const stationId = isStationId(stationParam) ? stationParam : "hinglish"
    const langParam = url.searchParams.get("lang")
    const lang = isNewsLang(langParam)
      ? langParam
      : stationById(stationId).newsLang
    const topicParam = url.searchParams.get("topic") as NewsTopic | null
    const topic = topicParam && TOPICS.has(topicParam) ? topicParam : "general"
    return Response.json(await getNews(lang, topic, stationId, request.signal))
  } catch (err) {
    return errorResponse(err, "news")
  }
}
