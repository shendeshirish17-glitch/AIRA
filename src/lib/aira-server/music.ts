// YouTube Data API v3 search for embeddable music videos, cached for 30 minutes
// because each search costs 100 quota units.
import type { MusicResponse, MusicTrack } from "@/aira/protocol"
import {
  LANG_TO_NEWS,
  stationById,
  vibeById,
  type LangCode,
} from "@/aira/stations"
import { serverConfig } from "./config"
import {
  TtlCache,
  UpstreamError,
  decodeEntities,
  fetchWithTimeout,
  upstreamStatusError,
} from "./http"

const cache = new TtlCache<MusicTrack[]>(30 * 60_000)

const SONG_WORDS =
  /\b(song|songs|music|gaana|gaane|track|tracks|album|lofi|playlist)\b|गाना|गाने|गाणी|गाणं|பாட்டு|பாடல்/i

export function buildMusicQuery(
  query: string | undefined,
  stationId: string,
  vibeId: string,
): string {
  const station = stationById(stationId)
  const vibe = vibeById(vibeId)
  const q = (query ?? "").trim()
  if (!q) return `${vibe.mood} ${station.musicHint}`.trim()
  return SONG_WORDS.test(q) ? q : `${q} songs`
}

export async function searchMusic(
  query: string,
  lang: LangCode,
  signal?: AbortSignal,
): Promise<MusicResponse> {
  const { apiKey, regionCode } = serverConfig().youtube
  if (!apiKey)
    throw new UpstreamError(
      "not_configured",
      "YOUTUBE_API_KEY is not set.",
      503,
    )
  const relevance = LANG_TO_NEWS[lang]
  const key = `${relevance}:${query.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) return { query, tracks: hit, cached: true }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    videoCategoryId: "10",
    safeSearch: "moderate",
    maxResults: "12",
    regionCode,
    relevanceLanguage: relevance,
    q: query,
    key: apiKey,
  })
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/youtube/v3/search?${params}`,
    { signal, timeoutMs: 8000 },
    "YouTube",
  )
  if (res.status === 403) {
    throw new UpstreamError(
      "rate_limited",
      "YouTube quota exhausted or key not allowed for Data API v3.",
      429,
    )
  }
  if (!res.ok) throw upstreamStatusError("YouTube", res.status)
  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string }
      snippet?: {
        title?: string
        channelTitle?: string
        liveBroadcastContent?: string
        thumbnails?: Record<string, { url?: string }>
      }
    }>
  }
  const tracks: MusicTrack[] = []
  for (const item of data.items ?? []) {
    const id = item.id?.videoId
    const sn = item.snippet
    if (!id || !/^[\w-]{6,20}$/.test(id) || !sn?.title) continue
    if (sn.liveBroadcastContent && sn.liveBroadcastContent !== "none") continue
    tracks.push({
      videoId: id,
      title: decodeEntities(sn.title),
      channel: decodeEntities(sn.channelTitle ?? ""),
      thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url,
    })
  }
  if (tracks.length) cache.set(key, tracks)
  return { query, tracks, cached: false }
}
