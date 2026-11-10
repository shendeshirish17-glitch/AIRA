// Deterministic multilingual intent parser and reply templates. Used directly
// when Evon is not configured, for fast control intents, and as the fallback
// whenever the LLM fails or returns something unusable.
import type {
  ConverseRequest,
  ConverseResponse,
  IntentName,
  NewsTopic,
} from "@/aira/protocol"
import {
  LANG_TO_NEWS,
  stationById,
  vibeById,
  type LangCode,
  type NewsLang,
  type StationId,
  type VibeId,
} from "@/aira/stations"

export function normalize(text: string): string {
  return tidy(text).toLowerCase()
}

function tidy(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[.,!?;:।॥"“”‘’()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Latin words match on word boundaries; Indic-script words match as substrings. */
function has(text: string, words: string[]): boolean {
  return words.some((w) =>
    /^[a-z0-9]/.test(w)
      ? new RegExp(`(^| )${escapeRe(w)}( |$)`).test(text)
      : text.includes(w),
  )
}

const DEVANAGARI = /[\u0900-\u097F]/
const TAMIL = /[\u0B80-\u0BFF]/
const MARATHI_MARKERS = [
  "बातम्या",
  "बातमी",
  "आहे",
  "काय",
  "मराठी",
  "लाव",
  "ऐकव",
  "सांग",
  "गाणी",
  "गाणं",
  "मला",
]

// ---------- vocabulary ----------

const NEWS_WORDS = [
  "news",
  "headlines",
  "headline",
  "khabar",
  "khabrein",
  "khabren",
  "samachar",
  "batmya",
  "bulletin",
  "खबर",
  "ख़बर",
  "खबरें",
  "समाचार",
  "बातम्या",
  "बातमी",
  "செய்தி",
  "செய்திகள்",
  "நியூஸ்",
  "न्यूज़",
  "न्यूज",
]
const PODCAST_WORDS = ["podcast", "podcasts", "पॉडकास्ट", "பாட்காஸ்ட்", "பாட்காஸ்ட"]
const NEXT_WORDS = [
  "next",
  "skip",
  "agla",
  "agla gaana",
  "dusra gaana",
  "doosra gaana",
  "change song",
  "change the song",
  "अगला",
  "दूसरा गाना",
  "पुढचं",
  "पुढचे",
  "पुढील",
  "दुसरं गाणं",
  "அடுத்த",
  "வேற பாட்டு",
  "வேற சாங்",
]
const PAUSE_WORDS = [
  "pause",
  "hold on",
  "ruko",
  "roko",
  "ruk jao",
  "rok do",
  "रुको",
  "रोको",
  "रोक दो",
  "थांब",
  "थांबव",
  "थांबा",
  "இடைநிறுத்து",
  "கொஞ்சம் நிறுத்து",
  "pause பண்ணு",
]
const STOP_WORDS = [
  "stop",
  "stop it",
  "band karo",
  "band kar do",
  "बंद करो",
  "बंद कर दो",
  "बंद कर",
  "बंद करा",
  "நிறுத்து",
  "நிறுத்துங்க",
  "stop பண்ணு",
]
const RESUME_WORDS = [
  "resume",
  "continue",
  "unpause",
  "play again",
  "keep playing",
  "phir se chalao",
  "phir chalao",
  "chalu karo",
  "wapas chalao",
  "फिर से चलाओ",
  "चालू करो",
  "चालू कर",
  "पुन्हा सुरू",
  "सुरू कर",
  "सुरू करा",
  "தொடரு",
  "தொடர்ந்து போடு",
  "மீண்டும் போடு",
  "continue பண்ணு",
]
const MUSIC_WORDS = [
  "play",
  "song",
  "songs",
  "music",
  "track",
  "gaana",
  "gana",
  "gaane",
  "gane",
  "bajao",
  "sunao",
  "chalao",
  "lagao",
  "गाना",
  "गाने",
  "गीत",
  "बजाओ",
  "सुनाओ",
  "चलाओ",
  "लगाओ",
  "संगीत",
  "गाणं",
  "गाणी",
  "गाणे",
  "लाव",
  "वाजव",
  "ऐकव",
  "பாட்டு",
  "பாடல்",
  "பாடல்கள்",
  "பாட்டுகள்",
  "போடு",
  "சாங்",
  "மியூசிக்",
]
const SPEAK_WORDS = [
  "speak",
  "talk",
  "reply",
  "respond",
  "bolo",
  "baat karo",
  "boliye",
  "बोलो",
  "बोलिए",
  "बात करो",
  "बोल",
  "बोला",
  "பேசு",
  "பேசுங்க",
  "பேசுங்கள்",
]
const STATION_WORDS = [
  "station",
  "channel",
  "frequency",
  "tune",
  "switch",
  "स्टेशन",
  "चैनल",
  "ஸ்டேஷன்",
  "சேனல்",
]
const MOOD_WORDS = ["mood", "vibe", "mode", "मूड", "माहौल", "मोड", "மூட்", "மோட்"]

const LANG_NAMES: Array<{
  lang: LangCode
  news: NewsLang
  station: StationId
  words: string[]
}> = [
  {
    lang: "en-IN",
    news: "en",
    station: "hinglish",
    words: [
      "english",
      "angrezi",
      "angreji",
      "अंग्रेज़ी",
      "अंग्रेजी",
      "इंग्रजी",
      "इंग्लिश",
      "ஆங்கிலம்",
      "ஆங்கிலத்தில்",
      "இங்கிலீஷ்",
    ],
  },
  {
    lang: "hi-en",
    news: "hi",
    station: "hinglish",
    words: ["hinglish", "हिंग्लिश"],
  },
  {
    lang: "hi-IN",
    news: "hi",
    station: "hinglish",
    words: ["hindi", "हिंदी", "हिन्दी", "ஹிந்தி", "இந்தி"],
  },
  {
    lang: "mr-IN",
    news: "mr",
    station: "marathi",
    words: ["marathi", "मराठी", "மராத்தி"],
  },
  {
    lang: "ta-IN",
    news: "ta",
    station: "tamil",
    words: ["tamil", "tanglish", "तमिल", "तमिळ", "தமிழ்", "தமிழில்"],
  },
]

const RJ_NAMES: Array<{ station: StationId; words: string[] }> = [
  {
    station: "tamil",
    words: ["kavya", "काव्या", "காவ்யா", "92.7", "92 point 7", "ninety two"],
  },
  {
    station: "hinglish",
    words: ["kabir", "कबीर", "கபீர்", "98.3", "98 point 3", "ninety eight"],
  },
  {
    station: "marathi",
    words: [
      "aarya",
      "arya",
      "आर्या",
      "ஆர்யா",
      "104.2",
      "104 point 2",
      "one oh four",
    ],
  },
]

const VIBE_WORDS: Array<{ vibe: VibeId; words: string[] }> = [
  {
    vibe: "morning",
    words: ["morning", "subah", "सुबह", "सकाळ", "காலை", "fresh", "energetic"],
  },
  {
    vibe: "chill",
    words: [
      "chill",
      "late night",
      "relax",
      "relaxing",
      "calm",
      "raat",
      "रात",
      "रात्र",
      "शांत",
      "இரவு",
      "அமைதி",
    ],
  },
  {
    vibe: "bollywood",
    words: [
      "bollywood",
      "party",
      "dance",
      "hits",
      "बॉलीवुड",
      "पार्टी",
      "பார்ட்டி",
      "குத்து",
    ],
  },
]

const TOPICS: Array<{ topic: NewsTopic; words: string[] }> = [
  {
    topic: "sports",
    words: [
      "sports",
      "sport",
      "cricket",
      "football",
      "khel",
      "खेल",
      "क्रिकेट",
      "क्रीडा",
      "விளையாட்டு",
      "கிரிக்கெட்",
    ],
  },
  {
    topic: "business",
    words: [
      "business",
      "market",
      "markets",
      "economy",
      "stock",
      "vyapar",
      "व्यापार",
      "बिज़नेस",
      "बाज़ार",
      "अर्थव्यवस्था",
      "व्यवसाय",
      "வணிகம்",
      "பொருளாதாரம்",
    ],
  },
  {
    topic: "technology",
    words: [
      "tech",
      "technology",
      "ai",
      "gadgets",
      "तकनीक",
      "टेक्नोलॉजी",
      "तंत्रज्ञान",
      "தொழில்நுட்பம்",
    ],
  },
  {
    topic: "entertainment",
    words: [
      "entertainment",
      "movies",
      "movie",
      "film",
      "films",
      "cinema",
      "मनोरंजन",
      "फिल्म",
      "चित्रपट",
      "சினிமா",
      "திரைப்படம்",
      "பொழுதுபோக்கு",
    ],
  },
  {
    topic: "health",
    words: ["health", "स्वास्थ्य", "सेहत", "आरोग्य", "சுகாதாரம்", "ஆரோக்கியம்"],
  },
  { topic: "science", words: ["science", "space", "विज्ञान", "அறிவியல்"] },
  {
    topic: "world",
    words: [
      "world",
      "international",
      "global",
      "duniya",
      "दुनिया",
      "विश्व",
      "जग",
      "உலக",
    ],
  },
  {
    topic: "nation",
    words: [
      "india",
      "national",
      "desh",
      "देश",
      "भारत",
      "राष्ट्रीय",
      "இந்தியா",
      "தேசிய",
    ],
  },
]

const GENERIC_MUSIC = new Set([
  "",
  "song",
  "songs",
  "music",
  "a song",
  "some music",
  "some songs",
  "something",
  "anything",
  "gaana",
  "gaane",
  "gana",
  "gane",
  "koi gaana",
  "kuch",
  "गाना",
  "गाने",
  "कोई गाना",
  "कुछ",
  "गाणं",
  "गाणी",
  "एखादं गाणं",
  "பாட்டு",
  "பாடல்",
  "ஒரு பாட்டு",
  "பாடல்கள்",
  "podcast",
  "podcasts",
  "a podcast",
  "पॉडकास्ट",
  "பாட்காஸ்ட்",
  "koi",
  "ek",
  "some",
  "any",
  "a",
  "कोई",
  "एक",
  "एखादा",
  "एखादं",
  "ஒரு",
  "ஏதாவது",
])

const LEADING =
  /^(?:(?:hey|hi|ok|okay|yo|arre|arey)\s+)?(?:(?:aira|kabir|kavya|aarya|arya|rj)\s+)*(?:(?:can|could|would) you\s+|please\s+|pls\s+|plz\s+|i want to\s+|i wanna\s+|let'?s\s+|let me\s+)*(?:play|put on|start|queue|listen to|hear|bajao|chalao|sunao|lagao|laga do)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+|the\s+)?/i
const TRAILING =
  /\s+(?:bajao|baja do|chalao|chala do|sunao|suna do|lagao|laga do|play karo|play kar do|please|plz|pls|बजाओ|बजा दो|सुनाओ|सुना दो|चलाओ|चला दो|लगाओ|लगा दो|प्ले करो|लाव|लावा|वाजव|वाजवा|ऐकव|ऐकवा|போடு|போடுங்க|போடுங்கள்|ப்ளே பண்ணு|போட்டு விடு)$/i

/** Strips only command verbs at the edges; the remaining (possibly Indic) text is kept intact. */
export function extractQuery(raw: string, stripWords: string[] = []): string {
  // Keep the listener's casing for display and search; match case-insensitively.
  let q = tidy(raw)
  for (let i = 0; i < 3; i++) {
    const before = q
    q = q.replace(LEADING, "").replace(TRAILING, "").trim()
    if (q === before) break
  }
  for (const w of stripWords) {
    q = q.replace(new RegExp(`(^| )${escapeRe(w)}( |$)`, "gi"), " ").trim()
  }
  q = q.replace(/\s+/g, " ").trim()
  return GENERIC_MUSIC.has(q.toLowerCase()) ? "" : q.slice(0, 120)
}

export function detectExplicitLang(text: string) {
  return LANG_NAMES.find((l) => has(text, l.words))
}

/** News edition: explicit language name > script detection > station default. */
export function detectNewsLang(raw: string, fallback: NewsLang): NewsLang {
  const text = normalize(raw)
  const explicit = detectExplicitLang(text)
  if (explicit) return explicit.news
  if (TAMIL.test(raw)) return "ta"
  if (DEVANAGARI.test(raw))
    return MARATHI_MARKERS.some((m) => raw.includes(m)) ? "mr" : "hi"
  return fallback
}

export function detectTopic(raw: string): NewsTopic {
  const text = normalize(raw)
  return TOPICS.find((t) => has(text, t.words))?.topic ?? "general"
}

// ---------- replies ----------

type Phrases = Record<LangCode, string>

const pick = (p: Phrases, lang: LangCode) => p[lang]
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")

const REPLIES = {
  music: {
    "hi-en": "Bilkul! Ab suno {q}, enjoy karo.",
    "hi-IN": "ज़रूर! अब सुनिए {q}.",
    "en-IN": "Coming right up: {q}.",
    "mr-IN": "नक्की! आता ऐका {q}.",
    "ta-IN": "சூப்பர்! இப்போ கேளுங்க {q}.",
  },
  musicDefault: {
    "hi-en": "Chalo, kuch mast gaane lagate hain!",
    "hi-IN": "चलिए, कुछ बढ़िया गाने सुनते हैं!",
    "en-IN": "Let's get some music going!",
    "mr-IN": "चला, काही छान गाणी ऐकूया!",
    "ta-IN": "வாங்க, கொஞ்சம் நல்ல பாட்டு கேட்கலாம்!",
  },
  podcast: {
    "hi-en": "Ek badhiya podcast dhoondh raha hoon.",
    "hi-IN": "एक अच्छा पॉडकास्ट ढूँढते हैं।",
    "en-IN": "Let me find a good podcast for you.",
    "mr-IN": "एक छान पॉडकास्ट शोधूया.",
    "ta-IN": "ஒரு நல்ல பாட்காஸ்ட் தேடலாம்.",
  },
  news: {
    "hi-en": "Ek minute, taaza khabrein laata hoon.",
    "hi-IN": "एक पल, ताज़ा ख़बरें लाते हैं।",
    "en-IN": "One moment, getting the latest headlines.",
    "mr-IN": "एक क्षण, ताज्या बातम्या आणूया.",
    "ta-IN": "ஒரு நிமிடம், சமீபத்திய செய்திகள் வருது.",
  },
  pause: {
    "hi-en": "Paused.",
    "hi-IN": "रोक दिया।",
    "en-IN": "Paused.",
    "mr-IN": "थांबवलं.",
    "ta-IN": "நிறுத்தியாச்சு.",
  },
  resume: {
    "hi-en": "Chalo, wapas shuru.",
    "hi-IN": "फिर से शुरू।",
    "en-IN": "Resuming.",
    "mr-IN": "पुन्हा सुरू.",
    "ta-IN": "மீண்டும் தொடருது.",
  },
  stop: {
    "hi-en": "Theek hai, band kar diya.",
    "hi-IN": "ठीक है, बंद कर दिया।",
    "en-IN": "Stopped.",
    "mr-IN": "ठीक आहे, बंद केलं.",
    "ta-IN": "சரி, நிறுத்தியாச்சு.",
  },
  next: {
    "hi-en": "Agla gaana!",
    "hi-IN": "अगला गाना!",
    "en-IN": "Next track!",
    "mr-IN": "पुढचं गाणं!",
    "ta-IN": "அடுத்த பாட்டு!",
  },
  station: {
    "hi-en": "Welcome to {freq}! Main hoon {rj}.",
    "hi-IN": "{freq} पर स्वागत है! मैं {rj}.",
    "en-IN": "You're tuned to {freq}. This is {rj}.",
    "mr-IN": "{freq} वर स्वागत आहे! मी {rj}.",
    "ta-IN": "{freq}-க்கு வரவேற்கிறோம்! நான் {rj}.",
  },
  language: {
    "hi-en": "Done! Ab main Hinglish mein baat karunga.",
    "hi-IN": "ठीक है, अब हिंदी में बात करते हैं।",
    "en-IN": "Sure, I'll speak English from now on.",
    "mr-IN": "ठीक आहे, आता मराठीत बोलूया.",
    "ta-IN": "சரி, இனி தமிழில் பேசலாம்.",
  },
  mood: {
    "hi-en": "{vibe} mode on!",
    "hi-IN": "{vibe} मूड चालू!",
    "en-IN": "{vibe} mode is on.",
    "mr-IN": "{vibe} मूड सुरू!",
    "ta-IN": "{vibe} மூட் ஆன்!",
  },
  greet: {
    "hi-en": "Hello hello! Batao, kya sunna hai? Gaane, podcast ya khabrein?",
    "hi-IN": "नमस्ते! बताइए, क्या सुनना है? गाने, पॉडकास्ट या ख़बरें?",
    "en-IN": "Hey there! Want music, a podcast, or the news?",
    "mr-IN": "नमस्कार! काय ऐकायचं? गाणी, पॉडकास्ट की बातम्या?",
    "ta-IN": "வணக்கம்! என்ன கேட்கணும்? பாட்டு, பாட்காஸ்ட், இல்ல செய்திகள்?",
  },
  tired: {
    "hi-en": "Arre, thoda relax karo. Ye soothing gaane sirf tumhare liye.",
    "hi-IN": "थोड़ा आराम कीजिए। ये सुकून भरे गाने आपके लिए।",
    "en-IN": "Take it easy. Here's something soothing for you.",
    "mr-IN": "थोडा आराम करा. ही शांत गाणी तुमच्यासाठी.",
    "ta-IN": "கொஞ்சம் ரிலாக்ஸ் பண்ணுங்க. இந்த இனிமையான பாட்டு உங்களுக்காக.",
  },
  happy: {
    "hi-en": "Wah, kya baat hai! Is mood ke liye kuch dhamakedaar!",
    "hi-IN": "वाह, क्या बात है! इस मूड के लिए कुछ धमाकेदार!",
    "en-IN": "Love that energy! Here's something upbeat.",
    "mr-IN": "व्वा, मस्तच! या मूडसाठी काहीतरी धमाकेदार!",
    "ta-IN": "அருமை! இந்த மூடுக்கு ஒரு ஜாலியான பாட்டு!",
  },
  thanks: {
    "hi-en": "Anytime, dost! Aur kuch sunna hai?",
    "hi-IN": "आपका स्वागत है! और कुछ सुनना है?",
    "en-IN": "Anytime! Anything else you want to hear?",
    "mr-IN": "कधीही! अजून काही ऐकायचं आहे का?",
    "ta-IN": "எப்போதும்! வேற ஏதாவது கேட்கணுமா?",
  },
  who: {
    "hi-en":
      "Main {rj} hoon, tumhara AI radio jockey. Gaane, podcast, khabrein, sab yahin!",
    "hi-IN": "मैं {rj}, आपका AI रेडियो जॉकी। गाने, पॉडकास्ट, ख़बरें, सब यहीं!",
    "en-IN":
      "I'm {rj}, your AI radio jockey. Music, podcasts and news, all by voice.",
    "mr-IN": "मी {rj}, तुमची AI रेडिओ जॉकी. गाणी, पॉडकास्ट, बातम्या, सगळं इथे!",
    "ta-IN": "நான் {rj}, உங்க AI ரேடியோ ஜாக்கி. பாட்டு, பாட்காஸ்ட், செய்திகள் எல்லாம் இங்கே!",
  },
  help: {
    "hi-en":
      'Bolo "Arijit ke gaane bajao", "news sunao" ya "koi podcast lagao".',
    "hi-IN": 'कहिए "अरिजीत के गाने बजाओ", "ख़बरें सुनाओ" या "कोई पॉडकास्ट लगाओ"।',
    "en-IN":
      'Try "play some A R Rahman", "tell me the news" or "play a podcast".',
    "mr-IN": 'म्हणा "अजय अतुलची गाणी लाव", "बातम्या सांग" किंवा "पॉडकास्ट लाव".',
    "ta-IN":
      '"இளையராஜா பாட்டு போடு", "செய்திகள் சொல்லு", அல்லது "பாட்காஸ்ட் போடு" என்று சொல்லுங்க.',
  },
} satisfies Record<string, Phrases>

export function replyFor(
  key: keyof typeof REPLIES,
  lang: LangCode,
  vars: Record<string, string> = {},
): string {
  return fill(pick(REPLIES[key], lang), vars)
}

// ---------- parser ----------

const GREET_WORDS = [
  "hi",
  "hello",
  "hey",
  "namaste",
  "namaskar",
  "vanakkam",
  "नमस्ते",
  "नमस्कार",
  "வணக்கம்",
]
const TIRED_WORDS = [
  "tired",
  "stressed",
  "stress",
  "sad",
  "upset",
  "bored",
  "thak",
  "thaka",
  "thaki",
  "udaas",
  "tension",
  "थका",
  "थकी",
  "थकान",
  "उदास",
  "तनाव",
  "थकल",
  "थकल्या",
  "कंटाळा",
  "டயர்டா",
  "சோர்வா",
  "சோகமா",
  "கவலை",
]
const HAPPY_WORDS = [
  "happy",
  "excited",
  "great mood",
  "khush",
  "mast",
  "खुश",
  "मस्त",
  "आनंदी",
  "छान",
  "சந்தோஷம்",
  "சந்தோஷமா",
  "ஜாலி",
]
const THANKS_WORDS = [
  "thanks",
  "thank you",
  "shukriya",
  "dhanyavad",
  "धन्यवाद",
  "शुक्रिया",
  "आभार",
  "நன்றி",
]
const WHO_WORDS = [
  "who are you",
  "your name",
  "kaun ho",
  "tum kaun",
  "आप कौन",
  "तुम कौन",
  "तू कोण",
  "तुम्ही कोण",
  "நீ யார்",
  "நீங்க யார்",
]

export function parseRules(req: ConverseRequest): ConverseResponse {
  const raw = req.text
  const text = normalize(raw)
  const station = stationById(req.stationId)
  const lang = req.lang
  const words = text ? text.split(" ").length : 0
  const out = (
    intent: IntentName,
    reply: string,
    extra: Partial<ConverseResponse> = {},
  ): ConverseResponse => ({
    intent,
    lang,
    reply,
    engine: "rules",
    ...extra,
  })

  if (!text) return out("chat", replyFor("help", lang, { rj: station.rj }))

  // Station switch: RJ names / frequencies, or station words + a language name.
  // RJ names can also be song/film names ("Kabir Singh"), so with music words
  // present only an explicit station word counts as a switch.
  const nameAllowed = !has(text, MUSIC_WORDS) || has(text, STATION_WORDS)
  const byName = nameAllowed
    ? RJ_NAMES.find((r) => has(text, r.words))
    : undefined
  const explicit = detectExplicitLang(text)
  const stationTarget =
    byName?.station ??
    (explicit && has(text, STATION_WORDS) ? explicit.station : undefined)
  if (stationTarget && !has(text, NEWS_WORDS) && !has(text, PODCAST_WORDS)) {
    const target = stationById(stationTarget)
    return out(
      "switch_station",
      replyFor("station", target.lang, {
        freq: String(target.freq),
        rj: target.rj,
      }),
      {
        stationId: target.id,
        lang: target.lang,
      },
    )
  }

  // Reply language change: "speak in English", "हिंदी में बोलो".
  if (explicit && has(text, SPEAK_WORDS)) {
    return out("set_language", replyFor("language", explicit.lang), {
      lang: explicit.lang,
    })
  }

  if (has(text, NEWS_WORDS)) {
    return out("news", replyFor("news", lang), {
      newsLang: detectNewsLang(
        raw,
        explicit?.news ?? station.newsLang ?? LANG_TO_NEWS[lang],
      ),
      topic: detectTopic(raw),
    })
  }

  if (has(text, PODCAST_WORDS)) {
    return out("play_podcast", replyFor("podcast", lang), {
      query: extractQuery(raw, PODCAST_WORDS) || station.podcastHint,
    })
  }

  if (has(text, NEXT_WORDS) && words <= 7)
    return out("next_track", replyFor("next", lang))

  if (words <= 6) {
    if (has(text, RESUME_WORDS)) return out("resume", replyFor("resume", lang))
    if (has(text, PAUSE_WORDS)) return out("pause", replyFor("pause", lang))
    if (has(text, STOP_WORDS)) return out("stop", replyFor("stop", lang))
  }

  const vibe = VIBE_WORDS.find((v) => has(text, v.words))
  if (vibe && has(text, MOOD_WORDS) && !has(text, ["play", "song", "songs"])) {
    return out(
      "set_mood",
      replyFor("mood", lang, { vibe: vibeById(vibe.vibe).label }),
      { vibeId: vibe.vibe },
    )
  }

  if (has(text, MUSIC_WORDS)) {
    const query = extractQuery(raw)
    // A bare "play" while something is paused means resume.
    if (
      !query &&
      req.media.kind !== "none" &&
      !req.media.playing &&
      words <= 2
    ) {
      return out("resume", replyFor("resume", lang))
    }
    return query
      ? out("play_music", replyFor("music", lang, { q: query }), { query })
      : out("play_music", replyFor("musicDefault", lang))
  }

  if (has(text, TIRED_WORDS)) {
    return out("play_music", replyFor("tired", lang), {
      query: `soothing relaxing ${station.musicHint}`,
    })
  }
  if (has(text, HAPPY_WORDS)) {
    return out("play_music", replyFor("happy", lang), {
      query: `upbeat party ${station.musicHint}`,
    })
  }
  if (has(text, THANKS_WORDS)) return out("chat", replyFor("thanks", lang))
  if (has(text, WHO_WORDS))
    return out("chat", replyFor("who", lang, { rj: station.rj }))
  if (has(text, GREET_WORDS)) return out("chat", replyFor("greet", lang))
  return out("chat", replyFor("help", lang))
}
