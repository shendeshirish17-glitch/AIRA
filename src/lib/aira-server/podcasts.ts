// Podcast search: Podcast Index when keys are configured, Apple iTunes Search otherwise
// (or when Podcast Index fails or returns nothing playable).
import { createHash } from "node:crypto"
import type { PodcastEpisode, PodcastResponse } from "@/aira/protocol"
import { serverConfig } from "./config"
import {
  TtlCache,
  fetchWithTimeout,
  isHttpUrl,
  stripHtml,
  upstreamStatusError,
} from "./http"

const cache = new TtlCache<PodcastResponse>(15 * 60_000)
const UA = "AIRa/1.0 (voice radio prototype)"

/** Enclosure must be an http(s) URL; when a MIME type is declared it must be audio. */
function playable(url: unknown, type?: unknown): url is string {
  if (!isHttpUrl(url)) return false
  return typeof type === "string" && type ? type.startsWith("audio/") : true
}

const short = (s: string | undefined, max = 280) => {
  if (!s) return undefined
  const clean = stripHtml(s)
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

async function podcastIndex(
  query: string,
  signal?: AbortSignal,
): Promise<PodcastEpisode[]> {
  const { apiKey, apiSecret } = serverConfig().podcastIndex
  if (!apiKey || !apiSecret) return []
  const headers = () => {
    const date = Math.floor(Date.now() / 1000).toString()
    return {
      "User-Agent": UA,
      "X-Auth-Key": apiKey,
      "X-Auth-Date": date,
      Authorization: createHash("sha1")
        .update(apiKey + apiSecret + date)
        .digest("hex"),
    }
  }
  const base = "https://api.podcastindex.org/api/1.0"
  const search = await fetchWithTimeout(
    `${base}/search/byterm?${new URLSearchParams({ q: query, max: "4" })}`,
    { headers: headers(), signal, timeoutMs: 8000 },
    "Podcast Index",
  )
  if (!search.ok) throw upstreamStatusError("Podcast Index", search.status)
  const feeds =
    ((await search.json()) as {
      feeds?: Array<{ id?: number; title?: string; image?: string }>
    }).feeds ?? []
  const ids = feeds
    .map((f) => f.id)
    .filter((id): id is number => typeof id === "number")
    .slice(0, 3)
  if (!ids.length) return []
  const eps = await fetchWithTimeout(
    `${base}/episodes/byfeedid?${new URLSearchParams({ id: ids.join(","), max: "8" })}`,
    { headers: headers(), signal, timeoutMs: 8000 },
    "Podcast Index",
  )
  if (!eps.ok) throw upstreamStatusError("Podcast Index", eps.status)
  const items =
    ((await eps.json()) as {
      items?: Array<{
        id?: number
        title?: string
        feedTitle?: string
        feedId?: number
        enclosureUrl?: string
        enclosureType?: string
        duration?: number
        description?: string
        image?: string
        feedImage?: string
        link?: string
        datePublished?: number
      }>
    }).items ?? []
  const showName = new Map(feeds.map((f) => [f.id, f.title ?? ""]))
  return items
    .filter((it) => it.title && playable(it.enclosureUrl, it.enclosureType))
    .map((it) => ({
      id: `pi-${it.id}`,
      title: it.title!,
      show: it.feedTitle ?? showName.get(it.feedId) ?? "",
      audioUrl: it.enclosureUrl!,
      durationSec:
        typeof it.duration === "number" && it.duration > 0
          ? it.duration
          : undefined,
      description: short(it.description),
      artwork: isHttpUrl(it.image)
        ? it.image
        : isHttpUrl(it.feedImage)
          ? it.feedImage
          : undefined,
      link: isHttpUrl(it.link) ? it.link : undefined,
      published: it.datePublished
        ? new Date(it.datePublished * 1000).toISOString()
        : undefined,
    }))
}

async function itunes(
  query: string,
  signal?: AbortSignal,
): Promise<PodcastEpisode[]> {
  const params = new URLSearchParams({
    media: "podcast",
    entity: "podcastEpisode",
    term: query,
    country: "IN",
    limit: "12",
  })
  const res = await fetchWithTimeout(
    `https://itunes.apple.com/search?${params}`,
    { signal, timeoutMs: 8000, headers: { "User-Agent": UA } },
    "iTunes",
  )
  if (!res.ok) throw upstreamStatusError("iTunes", res.status)
  const data = (await res.json()) as {
    results?: Array<{
      trackId?: number
      trackName?: string
      collectionName?: string
      episodeUrl?: string
      episodeContentType?: string
      trackTimeMillis?: number
      description?: string
      shortDescription?: string
      artworkUrl600?: string
      artworkUrl160?: string
      trackViewUrl?: string
      collectionViewUrl?: string
      releaseDate?: string
    }>
  }
  return (data.results ?? [])
    .filter(
      (r) =>
        r.trackName &&
        playable(
          r.episodeUrl,
          r.episodeContentType === "audio"
            ? "audio/mpeg"
            : r.episodeContentType,
        ),
    )
    .map((r) => ({
      id: `it-${r.trackId}`,
      title: r.trackName!,
      show: r.collectionName ?? "",
      audioUrl: r.episodeUrl!,
      durationSec: r.trackTimeMillis
        ? Math.round(r.trackTimeMillis / 1000)
        : undefined,
      description: short(r.shortDescription || r.description),
      artwork: r.artworkUrl600 ?? r.artworkUrl160,
      link: r.trackViewUrl ?? r.collectionViewUrl,
      published: r.releaseDate,
    }))
}

export async function searchPodcasts(
  query: string,
  signal?: AbortSignal,
): Promise<PodcastResponse> {
  const key = query.toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  let result: PodcastResponse | null = null
  try {
    const eps = await podcastIndex(query, signal)
    if (eps.length)
      result = { query, source: "podcastindex", episodes: eps.slice(0, 8) }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err
    console.warn(
      "[aira:podcasts] Podcast Index failed, using iTunes:",
      err instanceof Error ? err.message : String(err),
    )
  }
  if (!result)
    result = {
      query,
      source: "itunes",
      episodes: (await itunes(query, signal)).slice(0, 8),
    }
  if (result.episodes.length) cache.set(key, result)
  return result
}
