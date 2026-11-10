// Headlines from GNews (when GNEWS_API_KEY is set) with Google News RSS as the
// keyless fallback. Bulletins only restate fetched headlines.
import { XMLParser } from "fast-xml-parser"
import type { NewsArticle, NewsResponse, NewsTopic } from "@/aira/protocol"
import {
  LANGUAGES,
  NEWS_LANG_TO_LANG,
  stationById,
  type LangCode,
  type NewsLang,
  type StationId,
} from "@/aira/stations"
import { evonConfigured, newsProvider, serverConfig } from "./config"
import {
  TtlCache,
  UpstreamError,
  decodeEntities,
  fetchWithTimeout,
  isHttpUrl,
  upstreamStatusError,
} from "./http"
import { evonChat } from "./evon"

const cache = new TtlCache<{
  articles: NewsArticle[]
  source: NewsResponse["source"]
}>(5 * 60_000)
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
})

const RSS_EDITION: Record<NewsLang, { hl: string; ceid: string }> = {
  en: { hl: "en-IN", ceid: "IN:en" },
  hi: { hl: "hi", ceid: "IN:hi" },
  mr: { hl: "mr", ceid: "IN:mr" },
  ta: { hl: "ta", ceid: "IN:ta" },
}

export function googleNewsUrl(lang: NewsLang, topic: NewsTopic): string {
  const { hl, ceid } = RSS_EDITION[lang]
  const qs = `hl=${hl}&gl=IN&ceid=${ceid}`
  return topic === "general"
    ? `https://news.google.com/rss?${qs}`
    : `https://news.google.com/rss/headlines/section/topic/${topic.toUpperCase()}?${qs}`
}

type RssItem = {
  title?: unknown
  link?: unknown
  pubDate?: unknown
  source?: unknown
}

async function googleRss(
  lang: NewsLang,
  topic: NewsTopic,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  const res = await fetchWithTimeout(
    googleNewsUrl(lang, topic),
    { signal, timeoutMs: 8000 },
    "Google News",
  )
  if (!res.ok) throw upstreamStatusError("Google News", res.status)
  const xml = await res.text()
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } }
  }
  const raw = doc.rss?.channel?.item
  const items = Array.isArray(raw) ? raw : raw ? [raw] : []
  const articles: NewsArticle[] = []
  for (const it of items) {
    const sourceName =
      typeof it.source === "string"
        ? it.source
        : it.source && typeof it.source === "object"
          ? String((it.source as Record<string, unknown>)["#text"] ?? "")
          : ""
    let title = typeof it.title === "string" ? decodeEntities(it.title) : ""
    // Google appends " - Source" to titles; keep the source separately.
    if (sourceName && title.endsWith(` - ${sourceName}`))
      title = title.slice(0, -(sourceName.length + 3))
    if (!title || !isHttpUrl(it.link)) continue
    articles.push({
      title: title.trim(),
      source: decodeEntities(sourceName) || "Google News",
      url: it.link,
      published:
        typeof it.pubDate === "string"
          ? new Date(it.pubDate).toISOString()
          : undefined,
    })
    if (articles.length >= 8) break
  }
  return articles
}

async function gnews(
  lang: NewsLang,
  topic: NewsTopic,
  signal?: AbortSignal,
): Promise<NewsArticle[]> {
  const key = serverConfig().news.gnewsKey
  if (!key) return []
  const params = new URLSearchParams({
    category: topic,
    lang,
    country: "in",
    max: "8",
    apikey: key,
  })
  const res = await fetchWithTimeout(
    `https://gnews.io/api/v4/top-headlines?${params}`,
    { signal, timeoutMs: 8000 },
    "GNews",
  )
  if (!res.ok) throw upstreamStatusError("GNews", res.status)
  const data = (await res.json()) as {
    articles?: Array<{
      title?: string
      url?: string
      publishedAt?: string
      source?: { name?: string }
    }>
  }
  return (data.articles ?? [])
    .filter((a) => a.title && isHttpUrl(a.url))
    .map((a) => ({
      title: a.title!.trim(),
      source: a.source?.name ?? "GNews",
      url: a.url!,
      published: a.publishedAt,
    }))
}

async function fetchEdition(
  lang: NewsLang,
  topic: NewsTopic,
  signal?: AbortSignal,
) {
  const key = `${lang}:${topic}`
  const hit = cache.get(key)
  if (hit) return hit
  let result: {
    articles: NewsArticle[]
    source: NewsResponse["source"]
  } | null = null
  if (newsProvider() === "gnews") {
    try {
      const articles = await gnews(lang, topic, signal)
      if (articles.length) result = { articles, source: "gnews" }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err
      console.warn(
        "[aira:news] GNews failed, using Google News RSS:",
        err instanceof Error ? err.message : String(err),
      )
    }
  }
  if (!result) {
    let articles = await googleRss(lang, topic, signal).catch(
      (err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") throw err
        return [] as NewsArticle[]
      },
    )
    // Topic sections are not available in every edition; fall back to top stories.
    if (!articles.length && topic !== "general")
      articles = await googleRss(lang, "general", signal)
    result = { articles, source: "google-rss" }
  }
  if (result.articles.length) cache.set(key, result)
  return result
}

const INTRO: Record<LangCode, string> = {
  "hi-en": "Yeh rahi abhi ki top headlines.",
  "hi-IN": "ये हैं अभी की मुख्य ख़बरें।",
  "en-IN": "Here are the top headlines right now.",
  "mr-IN": "या आहेत आत्ताच्या ठळक बातम्या.",
  "ta-IN": "இப்போதைய முக்கிய செய்திகள்.",
}
const OUTRO: Record<LangCode, string> = {
  "hi-en": "Bas itni si khabar. Links transcript mein hain.",
  "hi-IN": "अभी के लिए इतना ही। पूरी ख़बरों के लिंक ट्रांसक्रिप्ट में हैं।",
  "en-IN": "That's the bulletin. Full stories are linked in the transcript.",
  "mr-IN": "सध्या इतकंच. पूर्ण बातम्यांच्या लिंक ट्रान्सक्रिप्टमध्ये आहेत.",
  "ta-IN": "இவ்வளவுதான். முழு செய்திகளுக்கான இணைப்புகள் டிரான்ஸ்கிரிப்டில் உள்ளன.",
}

function templateBulletin(
  articles: NewsArticle[],
  lang: LangCode,
  note: string,
): string {
  const lines = articles.slice(0, 4).map((a) => `${a.title}. ${a.source}.`)
  return [note, INTRO[lang], ...lines, OUTRO[lang]].filter(Boolean).join(" ")
}

async function evonBulletin(
  articles: NewsArticle[],
  lang: LangCode,
  stationId: StationId,
  note: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const station = stationById(stationId)
  const list = articles
    .slice(0, 5)
    .map((a, i) => `${i + 1}. ${a.title} (${a.source})`)
    .join("\n")
  try {
    const text = await evonChat(
      [
        {
          role: "system",
          content: `You are ${station.persona}. Write a spoken radio news bulletin in ${LANGUAGES[lang].label} using ONLY the headlines provided. Do not add any facts, numbers, names, or context that are not in the headlines. Cover 3 or 4 headlines, credit each source by name, stay under 90 words. Plain text only, no lists, no markdown, no emojis.`,
        },
        {
          role: "user",
          content: `${
            note ? `Start by saying: ${note}\n` : ""
          }Headlines:\n${list}`,
        },
      ],
      { signal, maxTokens: 350, temperature: 0.3, timeoutMs: 12_000 },
    )
    const clean = text
      .replace(/[*#_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    return clean.length > 20 ? clean.slice(0, 900) : null
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err
    return null
  }
}

export async function getNews(
  requestedLang: NewsLang,
  topic: NewsTopic,
  stationId: StationId,
  signal?: AbortSignal,
): Promise<NewsResponse> {
  let actualLang = requestedLang
  let edition = await fetchEdition(requestedLang, topic, signal)
  if (!edition.articles.length && requestedLang !== "en") {
    actualLang = "en"
    edition = await fetchEdition("en", topic, signal)
  }
  if (!edition.articles.length) {
    throw new UpstreamError(
      "no_results",
      "No headlines are available right now.",
      502,
    )
  }
  const bulletinLang = NEWS_LANG_TO_LANG[actualLang]
  const note =
    actualLang !== requestedLang
      ? `${LANGUAGES[NEWS_LANG_TO_LANG[requestedLang]].label} headlines are not available right now, so here is the English edition.`
      : ""
  let bulletin: string | null = null
  let bulletinEngine: NewsResponse["bulletinEngine"] = "template"
  if (evonConfigured()) {
    bulletin = await evonBulletin(
      edition.articles,
      bulletinLang,
      stationId,
      note,
      signal,
    )
    if (bulletin) bulletinEngine = "evon"
  }
  return {
    requestedLang,
    actualLang,
    topic,
    source: edition.source,
    articles: edition.articles,
    bulletin:
      bulletin ?? templateBulletin(edition.articles, bulletinLang, note),
    bulletinLang,
    bulletinEngine,
  }
}
