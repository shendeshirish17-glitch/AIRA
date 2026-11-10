// Request/response shapes shared by the AIRa route handlers and the client.
import type { LangCode, NewsLang, StationId, VibeId } from "./stations"

export type IntentName = "play_music" | "next_track" | "pause" | "resume" | "stop" | "play_podcast" | "news" | "switch_station" | "set_language" | "set_mood" | "chat"

export const INTENTS: IntentName[] = [
  "play_music",
  "next_track",
  "pause",
  "resume",
  "stop",
  "play_podcast",
  "news",
  "switch_station",
  "set_language",
  "set_mood",
  "chat",
]

export type NewsTopic = "general" | "world" | "nation" | "business" | "technology" | "entertainment" | "sports" | "science" | "health"

export interface MediaContext {
  kind: "none" | "music" | "podcast"
  title?: string
  playing: boolean
}

export interface HistoryTurn {
  role: "user" | "assistant"
  text: string
}

export interface ConverseRequest {
  text: string
  stationId: StationId
  lang: LangCode
  vibeId: VibeId
  media: MediaContext
  history: HistoryTurn[]
}

export interface ConverseResponse {
  intent: IntentName
  /** Search query for music/podcasts (already stripped of command verbs). */
  query?: string
  /** Language for the spoken reply. */
  lang: LangCode
  stationId?: StationId
  vibeId?: VibeId
  newsLang?: NewsLang
  topic?: NewsTopic
  reply: string
  engine: "evon" | "rules"
}

export interface MusicTrack {
  videoId: string
  title: string
  channel: string
  thumbnail?: string
}

export interface MusicResponse {
  query: string
  tracks: MusicTrack[]
  cached: boolean
}

export interface PodcastEpisode {
  id: string
  title: string
  show: string
  audioUrl: string
  durationSec?: number
  description?: string
  artwork?: string
  link?: string
  published?: string
}

export interface PodcastResponse {
  query: string
  source: "podcastindex" | "itunes"
  episodes: PodcastEpisode[]
}

export interface NewsArticle {
  title: string
  source: string
  url: string
  published?: string
}

export interface NewsResponse {
  requestedLang: NewsLang
  actualLang: NewsLang
  topic: NewsTopic
  source: "gnews" | "google-rss"
  articles: NewsArticle[]
  bulletin: string
  bulletinLang: LangCode
  bulletinEngine: "evon" | "template"
}

export interface ProviderStatus {
  stt: { mode: "prisma" | "browser"; label: string }
  tts: { mode: "timbre" | "browser"; label: string }
  llm: { mode: "evon" | "rules"; label: string }
  music: { mode: "youtube" | "off"; label: string }
  podcasts: { mode: "podcastindex" | "itunes"; label: string }
  news: { mode: "gnews" | "google-rss"; label: string }
  missingVariables: string[]
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}
