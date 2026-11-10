import { stationById } from "@/aira/stations"
import { cleanText, errorResponse, rateLimit } from "@/lib/aira-server/http"
import { searchPodcasts } from "@/lib/aira-server/podcasts"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const limited = rateLimit(request, "podcasts", 30)
  if (limited) return limited
  try {
    const url = new URL(request.url)
    const query =
      cleanText(url.searchParams.get("q"), 120) ||
      stationById(url.searchParams.get("station") ?? undefined).podcastHint
    return Response.json(await searchPodcasts(query, request.signal))
  } catch (err) {
    return errorResponse(err, "podcasts")
  }
}
