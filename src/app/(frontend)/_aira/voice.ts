// Spoken output (Gnani Timbre via /api/aira/tts, browser speechSynthesis as the
// demo fallback) and browser speech recognition fallback.
import { LANGUAGES, type LangCode, type StationId } from "@/aira/stations"
import { api, ApiError, isAbort } from "./api"
import { analyserLevel, getAudioContext, speechAmp } from "./audio"

export type SpeakResult = "ended" | "cancelled"
export type VoiceMode = "timbre" | "browser"

export class VoicePlayer {
  private audio: HTMLAudioElement | null = null
  private url: string | null = null
  private analyser: AnalyserNode | null = null
  private buf: Uint8Array<ArrayBuffer> | null = null
  private synthActive = false
  private paused = false
  private finish: ((r: SpeakResult) => void) | null = null
  /** Set once Timbre is known to be unavailable, to skip the round trip. */
  timbreUnavailable = false
  lastMode: VoiceMode | null = null

  get speaking() {
    return (this.audio !== null || this.synthActive) && !this.paused
  }

  level(t: number): number {
    if (this.paused) return 0
    if (this.audio && this.analyser && this.buf)
      return analyserLevel(this.analyser, this.buf)
    return this.synthActive ? speechAmp(t) : 0
  }

  async speak(
    text: string,
    lang: LangCode,
    stationId: StationId,
    signal: AbortSignal,
  ): Promise<SpeakResult> {
    this.cancel()
    if (!this.timbreUnavailable) {
      try {
        const audio = await api.tts(text, lang, stationId, signal)
        if (signal.aborted) return "cancelled"
        this.lastMode = "timbre"
        return await this.playBuffer(audio, signal)
      } catch (err) {
        if (isAbort(err) || signal.aborted) return "cancelled"
        if (err instanceof ApiError && err.code === "not_configured")
          this.timbreUnavailable = true
        else
          console.warn(
            "[aira] Timbre failed, using browser voice:",
            err instanceof Error ? err.message : err,
          )
      }
    }
    this.lastMode = "browser"
    return this.speakBrowser(text, lang, signal)
  }

  private playBuffer(
    data: ArrayBuffer,
    signal: AbortSignal,
  ): Promise<SpeakResult> {
    return new Promise((resolve) => {
      this.url = URL.createObjectURL(new Blob([data], { type: "audio/mpeg" }))
      const audio = new Audio(this.url)
      this.audio = audio
      const ac = getAudioContext()
      // Blob URLs are same-origin, so routing through Web Audio is safe here.
      if (ac) {
        try {
          const src = ac.createMediaElementSource(audio)
          const analyser = ac.createAnalyser()
          analyser.fftSize = 512
          src.connect(analyser)
          analyser.connect(ac.destination)
          this.analyser = analyser
          this.buf = new Uint8Array(analyser.fftSize)
        } catch {
          this.analyser = null
        }
      }
      this.finish = resolve
      audio.onended = () => this.done("ended")
      audio.onerror = () => this.done("ended")
      signal.addEventListener("abort", () => this.cancel(), { once: true })
      audio.play().catch(() => this.done("ended"))
    })
  }

  private speakBrowser(
    text: string,
    lang: LangCode,
    signal: AbortSignal,
  ): Promise<SpeakResult> {
    const synth =
      typeof window !== "undefined" ? window.speechSynthesis : undefined
    if (!synth) return Promise.resolve("ended")
    const speechLang = LANGUAGES[lang].speech
    const voices = synth.getVoices()
    const voice =
      voices.find((v) => v.lang.replace("_", "-") === speechLang) ??
      voices.find((v) =>
        v.lang.toLowerCase().startsWith(speechLang.slice(0, 2)),
      ) ??
      voices.find((v) => v.lang.replace("_", "-") === "en-IN")
    // Chrome stops long utterances after ~15 s, so speak sentence by sentence.
    const chunks = text
      .match(/[^.!?।]+[.!?।]?/g)
      ?.map((c) => c.trim())
      .filter(Boolean) ?? [text]
    return new Promise((resolve) => {
      this.synthActive = true
      this.finish = resolve
      signal.addEventListener("abort", () => this.cancel(), { once: true })
      let i = 0
      const next = () => {
        if (!this.synthActive) return
        if (i >= chunks.length) return this.done("ended")
        const u = new SpeechSynthesisUtterance(chunks[i++])
        u.lang = speechLang
        if (voice) u.voice = voice
        u.rate = 1.02
        u.onend = next
        u.onerror = (e) =>
          e.error === "interrupted" || e.error === "canceled"
            ? undefined
            : next()
        synth.speak(u)
      }
      next()
    })
  }

  pause() {
    if (this.paused) return
    if (this.audio) this.audio.pause()
    else if (this.synthActive) window.speechSynthesis.pause()
    else return
    this.paused = true
  }

  resume() {
    if (!this.paused) return
    this.paused = false
    if (this.audio) void this.audio.play().catch(() => this.done("ended"))
    else if (this.synthActive) window.speechSynthesis.resume()
  }

  cancel() {
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute("src")
    }
    if (this.synthActive) window.speechSynthesis.cancel()
    this.done("cancelled")
  }

  private done(result: SpeakResult) {
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
    this.audio = null
    this.analyser = null
    this.synthActive = false
    this.paused = false
    const finish = this.finish
    this.finish = null
    finish?.(result)
  }
}

// ---------- browser speech recognition fallback ----------

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: {
    results: ArrayLike<ArrayLike<{ transcript: string }>>
  }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const browserSttSupported = () => recognitionCtor() !== null

/** One-shot recognition. Resolves '' when nothing was heard. */
export function recognizeOnce(
  lang: LangCode,
  signal: AbortSignal,
): Promise<string> {
  const Ctor = recognitionCtor()
  if (!Ctor) return Promise.reject(new Error("unsupported"))
  return new Promise((resolve, reject) => {
    const rec = new Ctor()
    rec.lang = LANGUAGES[lang].speech
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1
    let text = ""
    rec.onresult = (e) => {
      text = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim()
    }
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        reject(new Error("denied"))
    }
    rec.onend = () => resolve(text)
    signal.addEventListener("abort", () => rec.abort(), { once: true })
    try {
      rec.start()
    } catch {
      resolve("")
    }
  })
}
