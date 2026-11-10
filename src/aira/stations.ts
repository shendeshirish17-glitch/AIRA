// Shared (client + server) station, language, and vibe configuration.
// Visual values (freq, hue, speed, k, tags, greeting lines) come from the
// original AIRa design.

/** Reply/TTS language codes. All are documented Gnani Timbre `language` values. */
export type LangCode = "hi-en" | "hi-IN" | "en-IN" | "mr-IN" | "ta-IN"
export type SpeechLangCode = "hi-IN" | "en-IN" | "mr-IN" | "ta-IN"
/** News edition languages (Google News `hl` / GNews `lang`). */
export type NewsLang = "hi" | "en" | "mr" | "ta"
export type StationId = "tamil" | "hinglish" | "marathi"
export type VibeId = "morning" | "chill" | "bollywood"

export interface Station {
  id: StationId
  freq: number
  name: string
  rj: string
  /** Short persona description used in LLM prompts. */
  persona: string
  hue: number
  speed: number
  k: number
  tags: string[]
  /** Default reply language for this RJ. */
  lang: LangCode
  /**
   * Default news edition. Google News has no Hinglish edition, so the Hinglish
   * station defaults to the Hindi edition (Devanagari headlines, read in hi-IN);
   * "news in English" switches to the English edition on request.
   */
  newsLang: NewsLang
  /** Base YouTube search hint when the listener does not name a song. */
  musicHint: string
  podcastHint: string
  greeting: string
}

export interface Vibe {
  id: VibeId
  label: string
  hueShift: number
  warmth: number
  speedMult: number
  caption: string
  /** Search terms blended into music queries for this vibe. */
  mood: string
}

export const STATIONS: Station[] = [
  {
    id: "tamil",
    freq: 92.7,
    name: "Tamil · Tanglish",
    rj: "RJ Kavya",
    persona:
      "RJ Kavya, a warm, witty female Tamil radio jockey who mixes Tamil with a little English (Tanglish)",
    hue: 175,
    speed: 1.1,
    k: 1.5,
    tags: ["LIVE", "TAMIL HITS"],
    lang: "ta-IN",
    newsLang: "ta",
    musicHint: "Tamil songs",
    podcastHint: "Tamil podcast",
    greeting: "வணக்கம் நண்பர்களே! நான் RJ Kavya, 92.7-ல இருந்து. இன்னைக்கு மூடு எப்படி?",
  },
  {
    id: "hinglish",
    freq: 98.3,
    name: "Hinglish",
    rj: "RJ Kabir",
    persona:
      "RJ Kabir, an energetic, conversational male Hinglish radio jockey who speaks Hindi-English code-mix in Latin script",
    hue: 28,
    speed: 1.4,
    k: 1,
    tags: ["LIVE", "NEWS & BOLLYWOOD"],
    lang: "hi-en",
    newsLang: "hi",
    musicHint: "Hindi songs",
    podcastHint: "Hindi podcast",
    greeting:
      "Namaste doston! Main hoon RJ Kabir, 98.3 par. Aaj mood kaisa hai?",
  },
  {
    id: "marathi",
    freq: 104.2,
    name: "Marathi",
    rj: "RJ Aarya",
    persona: "RJ Aarya, a graceful, cheerful female Marathi radio jockey",
    hue: 315,
    speed: 0.8,
    k: 0.6,
    tags: ["LIVE", "MARATHI GOLD"],
    lang: "mr-IN",
    newsLang: "mr",
    musicHint: "Marathi songs",
    podcastHint: "Marathi podcast",
    greeting: "नमस्कार मित्रांनो! मी RJ आर्या, १०४.२ वर. आज मूड कसा आहे?",
  },
]

export const VIBES: Vibe[] = [
  {
    id: "morning",
    label: "Morning News",
    hueShift: 0,
    warmth: 0.7,
    speedMult: 1.2,
    caption: "Crisp energy · bright tones",
    mood: "upbeat",
  },
  {
    id: "chill",
    label: "Late Night Chill",
    hueShift: -20,
    warmth: 0.3,
    speedMult: 0.6,
    caption: "Slow waves · warm haze",
    mood: "chill lofi",
  },
  {
    id: "bollywood",
    label: "Bollywood Hits",
    hueShift: 15,
    warmth: 1,
    speedMult: 1.5,
    caption: "High energy · vibrant pulse",
    mood: "hits",
  },
]

export const LANGUAGES: Record<LangCode, {
  label: string
  short: string
  speech: SpeechLangCode
}> = {
  "hi-en": { label: "Hinglish", short: "HI·EN", speech: "hi-IN" },
  "hi-IN": { label: "Hindi", short: "HI", speech: "hi-IN" },
  "en-IN": { label: "English", short: "EN", speech: "en-IN" },
  "mr-IN": { label: "Marathi", short: "MR", speech: "mr-IN" },
  "ta-IN": { label: "Tamil", short: "TA", speech: "ta-IN" },
}

/**
 * Gnani Prisma `language_code` per reply language. Prisma's en-IN model accepts
 * English-Hindi mixed audio and returns Latin script, which suits Hinglish.
 */
export const STT_LANG: Record<LangCode, string> = {
  "hi-en": "en-IN",
  "hi-IN": "hi-IN",
  "en-IN": "en-IN",
  "mr-IN": "mr-IN",
  "ta-IN": "ta-IN",
}

export const NEWS_LANG_TO_LANG: Record<NewsLang, LangCode> = {
  hi: "hi-IN",
  en: "en-IN",
  mr: "mr-IN",
  ta: "ta-IN",
}

export const LANG_TO_NEWS: Record<LangCode, NewsLang> = {
  "hi-en": "hi",
  "hi-IN": "hi",
  "en-IN": "en",
  "mr-IN": "mr",
  "ta-IN": "ta",
}

export const stationById = (id: string | undefined): Station =>
  STATIONS.find((s) => s.id === id) ?? STATIONS[1]
export const vibeById = (id: string | undefined): Vibe =>
  VIBES.find((v) => v.id === id) ?? VIBES[0]
export const isLangCode = (v: unknown): v is LangCode =>
  typeof v === "string" && v in LANGUAGES
export const isSpeechLangCode = (v: unknown): v is SpeechLangCode =>
  v === "hi-IN" || v === "en-IN" || v === "mr-IN" || v === "ta-IN"
export const langFromSpeechCode = (
  speech: SpeechLangCode,
  preferred: LangCode,
): LangCode => {
  if (LANGUAGES[preferred].speech === speech) return preferred
  return speech
}
export const isStationId = (v: unknown): v is StationId =>
  STATIONS.some((s) => s.id === v)
export const isVibeId = (v: unknown): v is VibeId =>
  VIBES.some((s) => s.id === v)
export const isNewsLang = (v: unknown): v is NewsLang =>
  v === "hi" || v === "en" || v === "mr" || v === "ta"
