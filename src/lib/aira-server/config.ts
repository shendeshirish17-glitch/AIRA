// Server-only configuration. Only route handlers import this module; never
// import it from a 'use client' file because it reads secrets from process.env.
import type { ProviderStatus } from "@/aira/protocol"

const read = (key: string): string | undefined => {
  const value = process.env[key]
  return value && value.trim() ? value.trim() : undefined
}

function chatCompletionsUrl(base: string): string {
  const normalized = base.replace(/\/+$/, "")
  if (normalized.endsWith("/chat/completions")) return normalized
  return `${normalized}${
    normalized.endsWith("/v1") ? "" : "/v1"
  }/chat/completions`
}

export function serverConfig() {
  const vllmApiBase = read("VLLM_API_BASE")
  const evonUrl = read("EVON_API_URL")
  return {
    gnani: {
      apiKey: read("GNANI_API_KEY"),
      baseUrl: (read("GNANI_API_BASE_URL") ?? "https://api.vachana.ai").replace(
        /\/$/,
        "",
      ),
      ttsModel: read("GNANI_TTS_MODEL") ?? "timbre-v3.0",
    },
    evon: {
      provider: vllmApiBase ? "vllm" as const : "evon" as const,
      url: vllmApiBase ? chatCompletionsUrl(vllmApiBase) : evonUrl,
      apiKey: vllmApiBase
        ? (read("VLLM_API_KEY") ?? read("EVON_API_KEY"))
        : read("EVON_API_KEY"),
      model: vllmApiBase
        ? (read("VLLM_MODEL") ?? read("EVON_MODEL") ?? "evon")
        : (read("EVON_MODEL") ?? "evon"),
    },
    youtube: {
      apiKey: read("YOUTUBE_API_KEY"),
      regionCode: read("YOUTUBE_REGION_CODE") ?? "IN",
    },
    podcastIndex: {
      apiKey: read("PODCASTINDEX_API_KEY"),
      apiSecret: read("PODCASTINDEX_API_SECRET"),
    },
    news: {
      gnewsKey: read("GNEWS_API_KEY"),
      provider: read("NEWS_PROVIDER"),
    },
  }
}

export function newsProvider(): "gnews" | "google-rss" {
  const cfg = serverConfig().news
  if (cfg.provider === "google-rss") return "google-rss"
  return cfg.gnewsKey ? "gnews" : "google-rss"
}

export function evonConfigured(): boolean {
  const { url, apiKey, provider } = serverConfig().evon
  return Boolean(url && (provider === "vllm" || apiKey))
}

/** Which real providers are configured. Contains no secret values. */
export function providerStatus(): ProviderStatus {
  const cfg = serverConfig()
  const gnani = Boolean(cfg.gnani.apiKey)
  const pi = Boolean(cfg.podcastIndex.apiKey && cfg.podcastIndex.apiSecret)
  const missingVariables: Array<[string, boolean]> = [
    ["GNANI_API_KEY", gnani],
    ["YOUTUBE_API_KEY", Boolean(cfg.youtube.apiKey)],
    ["PODCASTINDEX_API_KEY", Boolean(cfg.podcastIndex.apiKey)],
    ["PODCASTINDEX_API_SECRET", Boolean(cfg.podcastIndex.apiSecret)],
    ["GNEWS_API_KEY", Boolean(cfg.news.gnewsKey)],
  ]
  if (cfg.evon.provider === "evon") {
    missingVariables.push([
      "VLLM_API_BASE or EVON_API_URL",
      Boolean(cfg.evon.url),
    ])
    if (cfg.evon.url)
      missingVariables.push(["EVON_API_KEY", Boolean(cfg.evon.apiKey)])
  }
  return {
    stt: gnani
      ? { mode: "prisma", label: "Gnani Prisma v2.5" }
      : { mode: "browser", label: "Browser speech recognition (fallback)" },
    tts: gnani
      ? { mode: "timbre", label: `Gnani Timbre (${cfg.gnani.ttsModel})` }
      : { mode: "browser", label: "Browser voice (fallback)" },
    llm: evonConfigured()
      ? {
          mode: "evon",
          label: `${
            cfg.evon.provider === "vllm" ? "vLLM" : "Evon"
          } (${cfg.evon.model})`,
        }
      : { mode: "rules", label: "Rule-based intents (LLM not configured)" },
    music: cfg.youtube.apiKey
      ? { mode: "youtube", label: "YouTube Data API v3 + IFrame player" }
      : { mode: "off", label: "YouTube not configured" },
    podcasts: pi
      ? { mode: "podcastindex", label: "Podcast Index" }
      : { mode: "itunes", label: "Apple iTunes Search (fallback)" },
    news:
      newsProvider() === "gnews"
        ? { mode: "gnews", label: "GNews (Google News RSS fallback)" }
        : { mode: "google-rss", label: "Google News RSS" },
    missingVariables: missingVariables
      .filter(([, configured]) => !configured)
      .map(([name]) => name),
  }
}
