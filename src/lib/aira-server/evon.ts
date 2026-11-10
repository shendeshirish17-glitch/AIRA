// Evon or local vLLM via an OpenAI-compatible chat-completions endpoint.
import {
  INTENTS,
  type ConverseRequest,
  type ConverseResponse,
  type IntentName,
  type NewsTopic,
} from "@/aira/protocol"
import {
  LANGUAGES,
  STATIONS,
  VIBES,
  isLangCode,
  isNewsLang,
  isStationId,
  isVibeId,
  stationById,
  vibeById,
} from "@/aira/stations"
import { evonConfigured, serverConfig } from "./config"
import {
  UpstreamError,
  cleanText,
  fetchWithTimeout,
  upstreamStatusError,
} from "./http"
import { detectNewsLang, detectTopic, parseRules } from "./rules"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export async function evonChat(
  messages: ChatMessage[],
  opts: {
    signal?: AbortSignal
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  } = {},
): Promise<string> {
  const { url, apiKey, model, provider } = serverConfig().evon
  if (!url || (provider === "evon" && !apiKey))
    throw new UpstreamError(
      "not_configured",
      "The LLM provider is not configured.",
      503,
    )
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const providerName = provider === "vllm" ? "vLLM" : "Evon"
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 300,
      }),
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? 12_000,
    },
    providerName,
  )
  if (!res.ok) throw upstreamStatusError(providerName, res.status)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) {
    throw new UpstreamError(
      "upstream",
      `${providerName} returned an empty reply.`,
    )
  }
  return content.trim()
}

/** Lenient JSON extraction: tolerates code fences and prose around the object. */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const unfenced = text.replace(/```(?:json)?/gi, "")
  const start = unfenced.indexOf("{")
  const end = unfenced.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    const value: unknown = JSON.parse(unfenced.slice(start, end + 1))
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const TOPICS: NewsTopic[] = [
  "general",
  "world",
  "nation",
  "business",
  "technology",
  "entertainment",
  "sports",
  "science",
  "health",
]

function systemPrompt(req: ConverseRequest): string {
  const station = stationById(req.stationId)
  const vibe = vibeById(req.vibeId)
  const langLabel = LANGUAGES[req.lang].label
  const media =
    req.media.kind === "none"
      ? "nothing"
      : `${req.media.kind} "${req.media.title ?? ""}" (${
          req.media.playing ? "playing" : "paused"
        })`
  return [
    `You are ${station.persona}, hosting ${station.freq} FM on AIRa, a voice-first AI radio.`,
    `Current reply language: ${langLabel} (${req.lang}). Hinglish means Hindi-English code-mix written in Latin script. Marathi and Hindi use Devanagari; Tamil uses Tamil script.`,
    `Current vibe: ${vibe.label}. Now playing: ${media}.`,
    `Stations: ${STATIONS.map((s) => `${s.id} (${s.freq}, ${s.rj}, ${s.name})`).join("; ")}.`,
    `Vibes: ${VIBES.map((v) => `${v.id} (${v.label})`).join("; ")}.`,
    "Classify the listener request and reply as the RJ. Respond with ONLY a JSON object, no prose, with keys:",
    `"intent": one of ${INTENTS.join(", ")};`,
    '"query": music or podcast search text (artist/song/genre/topic, keep original language words, no command verbs) or "";',
    '"language": reply language code, one of hi-en, hi-IN, en-IN, mr-IN, ta-IN (keep the current one unless asked to change);',
    '"station": station id when intent is switch_station, else "";',
    '"mood": vibe id when intent is set_mood, else "";',
    '"news_language": hi, en, mr or ta when intent is news, else "";',
    `"topic": one of ${TOPICS.join(", ")} when intent is news, else "";`,
    '"reply": what you say aloud, in the reply language, 1-2 short sentences, warm radio style, no emojis, no markdown.',
    "Never invent song titles, headlines, or facts. For news, only say you are fetching headlines.",
  ].join("\n")
}

function str(v: unknown, max = 160): string {
  return cleanText(v, max)
}

/** Fast deterministic intents skip the LLM to keep transport controls snappy. */
const FAST_INTENTS = new Set<IntentName>([
  "pause",
  "resume",
  "stop",
  "next_track",
])

export async function converse(
  req: ConverseRequest,
  signal?: AbortSignal,
): Promise<ConverseResponse> {
  const rules = parseRules(req)
  if (!evonConfigured() || FAST_INTENTS.has(rules.intent)) return rules

  try {
    const content = await evonChat(
      [
        { role: "system", content: systemPrompt(req) },
        ...req.history
          .slice(-6)
          .map((h) => ({ role: h.role, content: h.text }) as ChatMessage),
        { role: "user", content: req.text },
      ],
      { signal, maxTokens: 300, temperature: 0.5 },
    )
    const json = parseLooseJson(content)
    if (!json) {
      // A plain-text answer is still a usable reply for small talk; for actions
      // the deterministic parse is safer.
      const reply = str(content, 400)
      return rules.intent === "chat" && reply
        ? { ...rules, reply, engine: "evon" }
        : rules
    }
    const intent = INTENTS.includes(json.intent as IntentName)
      ? json.intent as IntentName
      : "chat"
    const reply = str(json.reply, 400)
    if (!reply) return rules
    let lang = isLangCode(json.language) ? json.language : req.lang
    const res: ConverseResponse = { intent, lang, reply, engine: "evon" }

    if (intent === "play_music" || intent === "play_podcast") {
      const query = str(json.query, 120)
      res.query =
        query ||
        (intent === "play_podcast"
          ? stationById(req.stationId).podcastHint
          : rules.query)
    }
    if (intent === "switch_station") {
      const target = isStationId(json.station) ? json.station : rules.stationId
      if (!target) return rules
      res.stationId = target
      if (!isLangCode(json.language) || json.language === req.lang)
        lang = stationById(target).lang
      res.lang = lang
    }
    if (intent === "set_mood") {
      const vibe = isVibeId(json.mood) ? json.mood : rules.vibeId
      if (!vibe) return { ...res, intent: "chat" }
      res.vibeId = vibe
    }
    if (intent === "news") {
      const station = stationById(req.stationId)
      res.newsLang = isNewsLang(json.news_language)
        ? json.news_language
        : detectNewsLang(req.text, station.newsLang)
      res.topic = TOPICS.includes(json.topic as NewsTopic)
        ? json.topic as NewsTopic
        : detectTopic(req.text)
    }
    return res
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err
    const providerName =
      serverConfig().evon.provider === "vllm" ? "vLLM" : "Evon"
    console.warn(
      `[aira:converse] ${providerName} failed, using rules:`,
      err instanceof Error ? err.message : String(err),
    )
    return rules
  }
}
