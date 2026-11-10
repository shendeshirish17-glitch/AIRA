// AiraController: the single source of truth for the voice radio. React reads
// it through useSyncExternalStore (subscribe/getSnapshot); the canvas reads
// audio levels every frame through getLevels() without re-rendering.
import type {
  ConverseResponse,
  HistoryTurn,
  MusicTrack,
  NewsArticle,
  PodcastEpisode,
  ProviderStatus,
} from "@/aira/protocol"
import {
  LANGUAGES,
  STATIONS,
  STT_LANG,
  stationById,
  isStationId,
  isVibeId,
  type LangCode,
  type StationId,
  type VibeId,
} from "@/aira/stations"
import { api, ApiError, isAbort } from "./api"
import { playStatic, unlockAudio } from "./audio"
import { MicEngine } from "./mic"
import {
  VoicePlayer,
  browserSttSupported,
  recognizeOnce,
  type VoiceMode,
} from "./voice"
import { encodeWav, resampleTo16k } from "./wav"
import { YT_STATE, loadYouTubeApi, type YTPlayer } from "./youtube"

export type Phase = "idle" | "listening" | "capturing" | "processing" | "speaking" | "error"
export type SpeakingKind = "reply" | "greeting" | "bulletin" | null
export type MicState = "off" | "requesting" | "on" | "denied" | "unavailable"

export interface Turn {
  id: number
  speaker: "rj" | "user" | "activity"
  text: string
  stationId: StationId
  ts: number
  links?: Array<{ title: string; url: string; source: string }>
}

export type Caption = { kind: "rj"; text: string } | {
  kind: "user"
  text: string
} | { kind: "status"; text: string } | {
  kind: "nowplaying"
  text: string
  sub?: string
} | { kind: "error"; text: string }

export type MediaState = {
  kind: "music"
  track: MusicTrack
  queue: MusicTrack[]
  index: number
  playing: boolean
  blocked: boolean
} | {
  kind: "podcast"
  episode: PodcastEpisode
  playing: boolean
  loading: boolean
  blocked: boolean
} | null

export interface Snapshot {
  phase: Phase
  speakingKind: SpeakingKind
  stationId: StationId
  vibeId: VibeId
  lang: LangCode
  mic: MicState
  handsFree: boolean
  pttActive: boolean
  caption: Caption
  hint: string | null
  turns: Turn[]
  media: MediaState
  progress: { current: number; duration: number }
  status: ProviderStatus | null
  voiceMode: VoiceMode | null
  sttMode: "prisma" | "browser" | "none" | null
  interruptAt: number
}

export interface Levels {
  rj: number
  user: number
  media: number
  mediaReactive: number
  processing: number
  error: number
}

type Hold = {
  kind: "tts" | "media"
  committed: boolean
  caption: Caption
  phase: Phase
} | null

const PREFS_KEY = "aira:prefs"

export class AiraController {
  private snap: Snapshot
  private listeners = new Set<() => void>()
  private mic: MicEngine
  private voice = new VoicePlayer()
  private gen = 0
  private turnAbort: AbortController | null = null
  private hold: Hold = null
  private history: HistoryTurn[] = []
  private ducked = false
  private yt: YTPlayer | null = null
  private ytReady = false
  private ytBlockTimer: ReturnType<typeof setTimeout> | null = null
  private podcastAudio: HTMLAudioElement | null = null
  private podcastToken = 0
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private greetTimer: ReturnType<typeof setTimeout> | null = null
  private errorTimer: ReturnType<typeof setTimeout> | null = null
  private hintTimer: ReturnType<typeof setTimeout> | null = null
  private recognizing = false
  private recAbort: AbortController | null = null
  private audioUnlocked = false
  private turnId = 1
  private errorLevel = 0
  private simulate: keyof Levels | null = null

  constructor() {
    const station = STATIONS[1]
    this.snap = {
      phase: "idle",
      speakingKind: null,
      stationId: station.id,
      vibeId: "morning",
      lang: station.lang,
      mic: "off",
      handsFree: false,
      pttActive: false,
      caption: { kind: "rj", text: station.greeting },
      hint: null,
      turns: [],
      media: null,
      progress: { current: 0, duration: 0 },
      status: null,
      voiceMode: null,
      sttMode: null,
      interruptAt: 0,
    }
    this.mic = new MicEngine({
      onSpeechStart: () => this.onSpeechStart(),
      onSpeechConfirmed: () => this.onSpeechConfirmed(),
      onFalseStart: () => this.onFalseStart(),
      onUtterance: (s, r) => void this.onUtterance(s, r),
      onNoSpeech: () => this.onNoSpeech(),
    })
  }

  // ---------- store ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    for (const fn of this.listeners) fn()
  }

  init() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as {
        stationId?: string
        vibeId?: string
      }
      if (isStationId(prefs.stationId)) {
        const st = stationById(prefs.stationId)
        this.set({
          stationId: st.id,
          lang: st.lang,
          caption: { kind: "rj", text: st.greeting },
        })
      }
      if (isVibeId(prefs.vibeId)) this.set({ vibeId: prefs.vibeId })
    } catch {
      /* ignore bad prefs */
    }
    api
      .status()
      .then((status) => {
        const sttMode =
          status.stt.mode === "prisma"
            ? "prisma"
            : browserSttSupported()
              ? "browser"
              : "none"
        this.voice.timbreUnavailable = status.tts.mode !== "timbre"
        this.set({ status, sttMode })
      })
      .catch(() =>
        this.set({ sttMode: browserSttSupported() ? "browser" : "none" }),
      )
    this.progressTimer = setInterval(() => this.pollProgress(), 500)
  }

  destroy() {
    this.recAbort?.abort()
    this.turnAbort?.abort()
    this.voice.cancel()
    this.mic.stop()
    this.stopMedia()
    for (const t of [
      this.greetTimer,
      this.errorTimer,
      this.hintTimer,
      this.ytBlockTimer,
    ])
      if (t) clearTimeout(t)
    if (this.progressTimer) clearInterval(this.progressTimer)
    this.progressTimer = null
  }

  private savePrefs() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          stationId: this.snap.stationId,
          vibeId: this.snap.vibeId,
        }),
      )
    } catch {
      /* storage unavailable */
    }
  }

  private gesture() {
    this.audioUnlocked = true
    void unlockAudio()
  }

  // ---------- levels (read per animation frame) ----------

  getLevels(t: number): Levels {
    const s = this.snap
    const capturing = s.phase === "capturing" || this.mic.speaking
    const micLevel = this.mic.active ? this.mic.getLevel() : 0
    const playing = !!s.media?.playing
    const duck = this.ducked ? 0.45 : 1
    this.errorLevel = s.phase === "error" ? 1 : this.errorLevel * 0.96
    const levels: Levels = {
      rj: this.voice.level(t),
      user: capturing ? micLevel : s.handsFree ? micLevel * 0.3 : 0,
      media: playing ? duck : 0,
      mediaReactive: playing
        ? (0.45 + 0.2 * Math.pow(Math.abs(Math.sin(t * 4.2)), 6)) * duck
        : 0,
      processing: s.phase === "processing" ? 1 : 0,
      error: this.errorLevel,
    }
    if (this.simulate) {
      const v =
        this.simulate === "media" || this.simulate === "mediaReactive"
          ? 0.6
          : Math.abs(Math.sin(t * 5)) * 0.8 + 0.2
      levels[this.simulate] = v
      if (this.simulate === "media")
        levels.mediaReactive =
          0.45 + 0.2 * Math.pow(Math.abs(Math.sin(t * 4.2)), 6)
    }
    return levels
  }

  /** ?dev=1 only: drive one waveform level without real audio. */
  setSimulation(kind: keyof Levels | null) {
    this.simulate = kind
  }

  // ---------- helpers ----------

  private newTurn() {
    this.gen += 1
    this.turnAbort?.abort()
    this.turnAbort = new AbortController()
    return { g: this.gen, signal: this.turnAbort.signal }
  }

  private addTurn(
    speaker: Turn["speaker"],
    text: string,
    links?: Turn["links"],
  ) {
    const turn: Turn = {
      id: this.turnId++,
      speaker,
      text,
      stationId: this.snap.stationId,
      ts: Date.now(),
      links,
    }
    this.set({ turns: [...this.snap.turns, turn].slice(-40) })
    if (speaker !== "activity") {
      this.history.push({ role: speaker === "rj" ? "assistant" : "user", text })
      this.history = this.history.slice(-8)
    }
  }

  private restPhase(): Phase {
    return this.snap.handsFree ? "listening" : "idle"
  }

  private rest() {
    this.set({ phase: this.restPhase(), speakingKind: null, pttActive: false })
    this.mic.setHot(!!this.snap.media?.playing)
    if (!this.hold) this.duck(false)
  }

  private showHint(text: string, ms = 5000) {
    if (this.hintTimer) clearTimeout(this.hintTimer)
    this.set({ hint: text })
    this.hintTimer = setTimeout(() => this.set({ hint: null }), ms)
  }

  private fail(message: string) {
    this.set({
      phase: "error",
      speakingKind: null,
      pttActive: false,
      caption: { kind: "error", text: message },
    })
    this.duck(false)
    if (this.errorTimer) clearTimeout(this.errorTimer)
    this.errorTimer = setTimeout(() => {
      if (this.snap.phase === "error") this.set({ phase: this.restPhase() })
    }, 3500)
  }

  private nowPlayingCaption(): Caption | null {
    const m = this.snap.media
    if (!m) return null
    if (m.kind === "music")
      return { kind: "nowplaying", text: m.track.title, sub: m.track.channel }
    return { kind: "nowplaying", text: m.episode.title, sub: m.episode.show }
  }

  // ---------- speaking ----------

  private async speak(
    text: string,
    lang: LangCode,
    kind: Exclude<SpeakingKind, null>,
    g: number,
    signal: AbortSignal,
  ) {
    this.set({
      phase: "speaking",
      speakingKind: kind,
      caption: { kind: "rj", text },
    })
    if (kind !== "bulletin") this.addTurn("rj", text)
    this.mic.setHot(true)
    if (this.snap.media?.playing) this.duck(true)
    const result = await this.voice.speak(
      text,
      lang,
      this.snap.stationId,
      signal,
    )
    if (g !== this.gen) return false
    this.set({ voiceMode: this.voice.lastMode })
    return result === "ended"
  }

  // ---------- stations & vibes ----------

  tune(delta: number) {
    const idx = STATIONS.findIndex((s) => s.id === this.snap.stationId)
    const next = Math.max(0, Math.min(STATIONS.length - 1, idx + delta))
    if (next === idx) return false
    this.gesture()
    this.setStation(STATIONS[next].id, true)
    return true
  }

  setStation(id: StationId, announce: boolean) {
    if (id === this.snap.stationId) return
    const station = stationById(id)
    playStatic()
    if (typeof navigator !== "undefined" && navigator.vibrate)
      navigator.vibrate(12)
    if (this.snap.phase === "speaking" || this.snap.phase === "processing") {
      this.newTurn()
      this.voice.cancel()
      this.rest()
    }
    this.set({
      stationId: id,
      lang: station.lang,
      caption: { kind: "rj", text: station.greeting },
    })
    this.savePrefs()
    if (this.greetTimer) clearTimeout(this.greetTimer)
    if (announce && this.audioUnlocked) {
      // Debounced so quick multi-station swipes only greet once.
      this.greetTimer = setTimeout(() => {
        if (
          this.snap.stationId !== id ||
          this.snap.phase === "capturing" ||
          this.snap.phase === "processing"
        )
          return
        const { g, signal } = this.newTurn()
        void this.speak(
          station.greeting,
          station.lang,
          "greeting",
          g,
          signal,
        ).then(() => {
          if (g === this.gen) this.rest()
        })
      }, 700)
    }
  }

  setVibe(id: VibeId) {
    this.set({ vibeId: id })
    this.savePrefs()
  }

  // ---------- mic / talking ----------

  private async ensureMic(): Promise<boolean> {
    if (this.mic.active) return true
    this.set({ mic: "requesting" })
    try {
      await this.mic.start()
      this.set({ mic: "on" })
      return true
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError")
      this.set({ mic: denied ? "denied" : "unavailable", handsFree: false })
      this.fail(
        denied
          ? "Microphone access was blocked. Allow it in your browser, or type below."
          : "No microphone available. You can type your request instead.",
      )
      return false
    }
  }

  async toggleHandsFree() {
    this.gesture()
    if (this.snap.handsFree) {
      this.set({ handsFree: false })
      this.recAbort?.abort()
      this.mic.setMode("off")
      this.mic.stop()
      this.set({ mic: "off" })
      if (this.snap.phase === "listening" || this.snap.phase === "capturing")
        this.rest()
      return
    }
    if (this.snap.sttMode === "none") {
      this.fail(
        "Speech recognition is not available in this browser. Type your request instead.",
      )
      return
    }
    if (!(await this.ensureMic())) return
    this.mic.setMode("handsfree")
    this.set({ handsFree: true })
    if (this.snap.phase === "idle" || this.snap.phase === "error")
      this.set({ phase: "listening" })
    this.mic.setHot(this.voice.speaking || !!this.snap.media?.playing)
    this.showHint(
      "Hands-free is on. Headphones work best so AIRa does not hear itself.",
      6000,
    )
  }

  /** Tap-to-talk (canvas tap, mic button press, or Space). */
  async talk() {
    this.gesture()
    if (this.snap.pttActive) {
      if (this.recognizing) return
      this.mic.flush()
      return
    }
    if (this.snap.sttMode === "none") {
      this.fail(
        "Speech recognition is not available in this browser. Type your request instead.",
      )
      return
    }
    // Tapping while AIRa talks is an explicit interruption.
    if (this.snap.phase === "speaking" || this.snap.phase === "processing") {
      this.newTurn()
      this.voice.cancel()
      this.set({ interruptAt: Date.now() })
    }
    if (!(await this.ensureMic())) return
    if (this.snap.media?.playing) this.duck(true)
    this.set({
      phase: "capturing",
      pttActive: true,
      caption: { kind: "status", text: "Listening…" },
    })
    if (this.snap.sttMode === "browser") {
      this.mic.setMode("off")
      await this.browserRecognize()
    } else {
      this.mic.setHot(false)
      this.mic.setMode("ptt")
    }
  }

  private async browserRecognize() {
    if (this.recognizing) return
    this.recognizing = true
    // Own abort controller: a soft-held RJ reply must survive until speech is real.
    this.recAbort = new AbortController()
    const signal = this.recAbort.signal
    const g = this.gen
    try {
      const text = await recognizeOnce(this.snap.lang, signal)
      if (signal.aborted) return
      if (!text) {
        if (this.hold) this.onFalseStart()
        else this.onNoSpeech()
        return
      }
      this.commitHold()
      await this.handleText(text)
    } catch (err) {
      if (isAbort(err) || signal.aborted) return
      void g
      this.fail(
        err instanceof Error && err.message === "denied"
          ? "Speech recognition permission was denied. Type your request instead."
          : "Browser speech recognition failed. Try again or type below.",
      )
    } finally {
      this.recognizing = false
      this.recAbort = null
      this.restoreMicMode()
    }
  }

  private restoreMicMode() {
    if (this.snap.handsFree && this.mic.active && this.mic.getMode() === "off")
      this.mic.setMode("handsfree")
  }

  /** End of a press-and-hold: send what was captured. */
  release() {
    if (
      this.snap.pttActive &&
      !this.recognizing &&
      this.mic.getMode() === "ptt"
    )
      this.mic.flush()
  }

  private onSpeechStart() {
    const s = this.snap
    const ttsActive = s.phase === "speaking" && this.voice.speaking
    if (s.pttActive) {
      this.set({ caption: { kind: "status", text: "Listening…" } })
      return
    }
    if (!s.handsFree) return
    if (ttsActive) {
      // Soft hold: pause the RJ at onset, cancel only once speech is confirmed.
      this.voice.pause()
      this.hold = {
        kind: "tts",
        committed: false,
        caption: s.caption,
        phase: s.phase,
      }
      this.set({ interruptAt: Date.now() })
    } else if (s.media?.playing) {
      this.duck(true)
      this.hold = {
        kind: "media",
        committed: false,
        caption: s.caption,
        phase: s.phase,
      }
    } else {
      this.hold = {
        kind: "media",
        committed: false,
        caption: s.caption,
        phase: s.phase,
      }
    }
    this.set({
      phase: "capturing",
      caption: { kind: "status", text: "Listening…" },
    })
    if (this.snap.sttMode === "browser") {
      this.mic.setMode("off")
      void this.browserRecognize()
    }
  }

  private commitHold() {
    if (!this.hold || this.hold.committed) return
    this.hold.committed = true
    if (this.hold.kind === "tts") {
      this.newTurn()
      this.voice.cancel()
    }
  }

  private onSpeechConfirmed() {
    if (this.snap.sttMode === "browser") return
    this.commitHold()
  }

  private onFalseStart() {
    const hold = this.hold
    this.hold = null
    if (this.snap.pttActive) return
    if (!hold) return
    if (hold.kind === "tts" && !hold.committed) {
      this.voice.resume()
      this.set({ phase: "speaking", caption: hold.caption })
      return
    }
    this.duck(false)
    this.set({
      phase: hold.committed ? this.restPhase() : hold.phase,
      caption: hold.caption,
    })
    if (this.snap.phase === "capturing") this.set({ phase: this.restPhase() })
  }

  private onNoSpeech() {
    this.hold = null
    this.duck(false)
    this.set({
      phase: this.restPhase(),
      pttActive: false,
      caption: this.nowPlayingCaption() ?? {
        kind: "status",
        text: "No speech heard. Tap to try again.",
      },
    })
    if (!this.snap.handsFree) this.stopMicSoon()
    else this.restoreMicMode()
  }

  private stopMicSoon() {
    // Release the mic after one-shot use so the browser recording indicator clears.
    if (!this.snap.handsFree && this.mic.getMode() === "off") {
      this.mic.stop()
      this.set({ mic: "off" })
    }
  }

  private async onUtterance(samples: Float32Array, rate: number) {
    if (this.snap.sttMode === "browser") return
    this.commitHold()
    this.hold = null
    const wasPtt = this.snap.pttActive
    this.set({ pttActive: false })
    if (wasPtt) this.stopMicSoon()
    this.restoreMicMode()
    const { g, signal } = this.newTurn()
    this.set({
      phase: "processing",
      caption: { kind: "status", text: "Thinking…" },
    })
    try {
      const wav = encodeWav(resampleTo16k(samples, rate))
      const { transcript } = await api.transcribe(
        wav,
        STT_LANG[this.snap.lang],
        signal,
      )
      if (g !== this.gen) return
      if (!transcript) {
        this.set({
          caption: this.nowPlayingCaption() ?? {
            kind: "status",
            text: "Didn't catch that. Try again?",
          },
        })
        this.rest()
        return
      }
      await this.handleText(transcript)
    } catch (err) {
      if (isAbort(err) || g !== this.gen) return
      this.fail(
        err instanceof ApiError
          ? `Speech recognition: ${err.message}`
          : "Speech recognition failed.",
      )
    }
  }

  // ---------- conversation ----------

  submitText(text: string) {
    this.gesture()
    const t = text.trim()
    if (t) void this.handleText(t)
  }

  private async handleText(text: string) {
    const { g, signal } = this.newTurn()
    this.voice.cancel()
    this.addTurn("user", text)
    this.set({ phase: "processing", caption: { kind: "user", text } })
    if (this.snap.media?.playing) this.duck(true)
    const s = this.snap
    const m = s.media
    let resp: ConverseResponse
    try {
      resp = await api.converse(
        {
          text,
          stationId: s.stationId,
          lang: s.lang,
          vibeId: s.vibeId,
          media: m
            ? {
                kind: m.kind,
                title: m.kind === "music" ? m.track.title : m.episode.title,
                playing: m.playing,
              }
            : { kind: "none", playing: false },
          history: this.history.slice(0, -1),
        },
        signal,
      )
    } catch (err) {
      if (isAbort(err) || g !== this.gen) return
      this.fail(err instanceof ApiError ? err.message : "Could not reach AIRa.")
      return
    }
    if (g !== this.gen) return
    await this.apply(resp, g, signal)
  }

  private async apply(resp: ConverseResponse, g: number, signal: AbortSignal) {
    const status = (text: string) => {
      this.addTurn("rj", text)
      this.set({
        caption: this.nowPlayingCaption() ?? { kind: "status", text },
      })
      this.rest()
    }
    switch (resp.intent) {
      case "pause":
        this.pauseMedia()
        return status(resp.reply)
      case "resume":
        if (!this.snap.media)
          return this.playDefault(g, signal, resp.reply, resp.lang)
        this.resumeMedia()
        return status(resp.reply)
      case "stop":
        this.stopMedia()
        return status(resp.reply)
      case "next_track":
        if (!this.snap.media) return status(resp.reply)
        this.next()
        this.rest()
        return
      case "switch_station":
        if (resp.stationId) this.setStation(resp.stationId, false)
        this.set({ lang: resp.lang })
        break
      case "set_language":
        this.set({ lang: resp.lang })
        break
      case "set_mood":
        if (resp.vibeId) this.setVibe(resp.vibeId)
        break
      case "play_music":
        return this.playMusic(resp.query, resp.reply, resp.lang, g, signal)
      case "play_podcast":
        return this.playPodcast(resp.query, resp.reply, resp.lang, g, signal)
      case "news":
        return this.playNews(resp, g, signal)
      default:
        break
    }
    await this.speak(resp.reply, resp.lang, "reply", g, signal)
    if (g !== this.gen) return
    this.rest()
    const np = this.nowPlayingCaption()
    if (np && this.snap.media?.playing) this.set({ caption: np })
  }

  private playDefault(
    g: number,
    signal: AbortSignal,
    reply?: string,
    lang?: LangCode,
  ) {
    return this.playMusic(
      undefined,
      reply ?? null,
      lang ?? this.snap.lang,
      g,
      signal,
    )
  }

  /** Play button with nothing loaded: start the station's default music. */
  playStationMusic() {
    this.gesture()
    const { g, signal } = this.newTurn()
    void this.playMusic(undefined, null, this.snap.lang, g, signal)
  }

  private async playMusic(
    query: string | undefined,
    reply: string | null,
    lang: LangCode,
    g: number,
    signal: AbortSignal,
  ) {
    const s = this.snap
    if (s.status?.music.mode === "off") {
      if (reply) this.addTurn("rj", reply)
      this.fail(
        "Music needs a YouTube Data API key (YOUTUBE_API_KEY). Podcasts and news still work.",
      )
      return
    }
    this.set({
      phase: "processing",
      caption: { kind: "status", text: "Finding music…" },
    })
    const search = api.music(
      { q: query, lang: s.lang, station: s.stationId, vibe: s.vibeId },
      signal,
    )
    search.catch(() => undefined)
    if (reply) {
      await this.speak(reply, lang, "reply", g, signal)
      if (g !== this.gen) return
    }
    try {
      const res = await search
      if (g !== this.gen) return
      if (!res.tracks.length) {
        this.fail(`No playable results for "${res.query}".`)
        return
      }
      this.startMusic(res.tracks)
      this.rest()
    } catch (err) {
      if (isAbort(err) || g !== this.gen) return
      this.fail(
        err instanceof ApiError
          ? `Music: ${err.message}`
          : "Music search failed.",
      )
    }
  }

  private async playPodcast(
    query: string | undefined,
    reply: string,
    lang: LangCode,
    g: number,
    signal: AbortSignal,
  ) {
    const search = api.podcasts(
      { q: query, station: this.snap.stationId },
      signal,
    )
    search.catch(() => undefined)
    await this.speak(reply, lang, "reply", g, signal)
    if (g !== this.gen) return
    this.set({
      phase: "processing",
      caption: { kind: "status", text: "Loading podcast…" },
    })
    try {
      const res = await search
      if (g !== this.gen) return
      if (!res.episodes.length) {
        this.fail(`No podcast episodes found for "${res.query}".`)
        return
      }
      const ok = await this.startPodcast(res.episodes)
      if (g !== this.gen) return
      if (!ok)
        this.fail("Could not play those podcast episodes. Try another search.")
      else this.rest()
    } catch (err) {
      if (isAbort(err) || g !== this.gen) return
      this.fail(
        err instanceof ApiError
          ? `Podcasts: ${err.message}`
          : "Podcast search failed.",
      )
    }
  }

  private async playNews(
    resp: ConverseResponse,
    g: number,
    signal: AbortSignal,
  ) {
    const fetchNews = api.news(
      { lang: resp.newsLang, topic: resp.topic, station: this.snap.stationId },
      signal,
    )
    fetchNews.catch(() => undefined)
    // Pause (not just duck) media for the bulletin, then resume afterwards.
    const wasPlaying = !!this.snap.media?.playing
    if (wasPlaying) this.pauseMedia()
    await this.speak(resp.reply, resp.lang, "reply", g, signal)
    if (g !== this.gen) return
    let news
    try {
      this.set({
        phase: "processing",
        caption: { kind: "status", text: "Fetching headlines…" },
      })
      news = await fetchNews
    } catch (err) {
      if (isAbort(err) || g !== this.gen) return
      this.fail(
        err instanceof ApiError
          ? `News: ${err.message}`
          : "Could not fetch the news.",
      )
      if (wasPlaying) this.resumeMedia()
      return
    }
    if (g !== this.gen) return
    const label = LANGUAGES[news.bulletinLang].label
    const source = news.source === "gnews" ? "GNews" : "Google News"
    this.addTurn(
      "activity",
      `News · ${label}${
        news.topic !== "general" ? ` · ${news.topic}` : ""
      } · via ${source}`,
      news.articles.slice(0, 6).map((a: NewsArticle) => ({
        title: a.title,
        url: a.url,
        source: a.source,
      })),
    )
    this.addTurn("rj", news.bulletin)
    const done = await this.speak(
      news.bulletin,
      news.bulletinLang,
      "bulletin",
      g,
      signal,
    )
    if (g !== this.gen) return
    if (done && wasPlaying) this.resumeMedia()
    this.rest()
  }

  // ---------- media: shared ----------

  private duck(on: boolean) {
    this.ducked = on
    if (this.yt && this.ytReady) this.yt.setVolume(on ? 20 : 100)
    if (this.podcastAudio) this.podcastAudio.volume = on ? 0.2 : 1
  }

  togglePlay() {
    this.gesture()
    const m = this.snap.media
    if (!m) return this.playStationMusic()
    if (m.playing) this.pauseMedia()
    else this.resumeMedia()
  }

  pauseMedia() {
    const m = this.snap.media
    if (!m) return
    if (m.kind === "music") this.yt?.pauseVideo()
    else this.podcastAudio?.pause()
    this.set({ media: { ...m, playing: false } })
    this.mic.setHot(this.voice.speaking)
  }

  resumeMedia() {
    const m = this.snap.media
    if (!m) return
    if (m.kind === "music") this.yt?.playVideo()
    else
      void this.podcastAudio
        ?.play()
        .catch(() =>
          this.set({ media: { ...m, blocked: true, playing: false } }),
        )
    this.set({ media: { ...m, playing: true, blocked: false } })
    this.mic.setHot(true)
  }

  next() {
    this.gesture()
    const m = this.snap.media
    if (m?.kind !== "music") return
    this.advanceTrack()
  }

  stopMedia() {
    const m = this.snap.media
    if (m?.kind === "music") this.yt?.stopVideo()
    this.disposePodcast()
    if (this.ytBlockTimer) clearTimeout(this.ytBlockTimer)
    this.set({ media: null, progress: { current: 0, duration: 0 } })
    if (this.snap.caption.kind === "nowplaying")
      this.set({ caption: { kind: "status", text: "Stopped." } })
    this.mic.setHot(this.voice.speaking)
  }

  seek(fraction: number) {
    const { duration } = this.snap.progress
    if (!duration) return
    const t = Math.max(0, Math.min(1, fraction)) * duration
    const m = this.snap.media
    if (m?.kind === "music") this.yt?.seekTo(t, true)
    else if (this.podcastAudio) this.podcastAudio.currentTime = t
    this.set({ progress: { current: t, duration } })
  }

  private pollProgress() {
    const m = this.snap.media
    if (!m) return
    let current = 0
    let duration = 0
    if (m.kind === "music" && this.yt && this.ytReady) {
      current = this.yt.getCurrentTime?.() ?? 0
      duration = this.yt.getDuration?.() ?? 0
    } else if (m.kind === "podcast" && this.podcastAudio) {
      current = this.podcastAudio.currentTime
      duration = Number.isFinite(this.podcastAudio.duration)
        ? this.podcastAudio.duration
        : (m.episode.durationSec ?? 0)
    }
    const p = this.snap.progress
    if (Math.abs(p.current - current) > 0.25 || p.duration !== duration)
      this.set({ progress: { current, duration } })
  }

  // ---------- media: YouTube ----------

  private startMusic(tracks: MusicTrack[]) {
    this.disposePodcast()
    const track = tracks[0]
    this.set({
      media: {
        kind: "music",
        track,
        queue: tracks,
        index: 0,
        playing: true,
        blocked: false,
      },
      progress: { current: 0, duration: 0 },
      caption: { kind: "nowplaying", text: track.title, sub: track.channel },
    })
    this.mic.setHot(true)
    if (this.yt && this.ytReady) {
      this.yt.loadVideoById(track.videoId)
      this.watchAutoplay()
    }
  }

  private advanceTrack() {
    const m = this.snap.media
    if (m?.kind !== "music") return
    const index = m.index + 1
    if (index >= m.queue.length) {
      this.stopMedia()
      this.set({
        caption: {
          kind: "status",
          text: "That's the end of this set. Ask for more music anytime.",
        },
      })
      return
    }
    const track = m.queue[index]
    // Between tracks AIRa stays quiet: just the caption changes.
    this.set({
      media: { ...m, track, index, playing: true, blocked: false },
      progress: { current: 0, duration: 0 },
      caption: { kind: "nowplaying", text: track.title, sub: track.channel },
    })
    if (this.yt && this.ytReady) {
      this.yt.loadVideoById(track.videoId)
      this.watchAutoplay()
    }
  }

  private watchAutoplay() {
    if (this.ytBlockTimer) clearTimeout(this.ytBlockTimer)
    this.ytBlockTimer = setTimeout(() => {
      const m = this.snap.media
      const state = this.yt?.getPlayerState?.()
      if (
        m?.kind === "music" &&
        m.playing &&
        state !== YT_STATE.PLAYING &&
        state !== YT_STATE.BUFFERING
      ) {
        this.set({ media: { ...m, playing: false, blocked: true } })
      }
    }, 3500)
  }

  /** Called by the visible media card; the player lives inside it. */
  mountYouTube(el: HTMLElement) {
    const m = this.snap.media
    if (m?.kind !== "music") return
    loadYouTubeApi()
      .then((YT) => {
        const current = this.snap.media
        if (current?.kind !== "music" || !el.isConnected) return
        this.yt = new YT.Player(el, {
          videoId: current.track.videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              this.ytReady = true
              e.target.setVolume(this.ducked ? 20 : 100)
              if (this.snap.media?.playing) {
                e.target.playVideo()
                this.watchAutoplay()
              }
            },
            onStateChange: (e) => this.onYtState(e.data),
            onError: () => this.advanceTrack(),
          },
        })
      })
      .catch(() => this.fail("Could not load the YouTube player."))
  }

  unmountYouTube() {
    try {
      this.yt?.destroy()
    } catch {
      /* player already gone */
    }
    this.yt = null
    this.ytReady = false
  }

  private onYtState(state: number) {
    const m = this.snap.media
    if (m?.kind !== "music") return
    if (state === YT_STATE.PLAYING) {
      if (!m.playing || m.blocked)
        this.set({ media: { ...m, playing: true, blocked: false } })
      this.mic.setHot(true)
    } else if (state === YT_STATE.PAUSED) {
      if (m.playing) this.set({ media: { ...m, playing: false } })
    } else if (state === YT_STATE.ENDED) {
      this.advanceTrack()
    }
  }

  // ---------- media: podcasts ----------

  private disposePodcast() {
    this.podcastToken += 1
    if (this.podcastAudio) {
      this.podcastAudio.pause()
      this.podcastAudio.removeAttribute("src")
      this.podcastAudio.load()
    }
    this.podcastAudio = null
  }

  /**
   * Tries up to three episodes. Each gets a fresh <audio> element and is NOT
   * routed through Web Audio: cross-origin media without CORS would be silenced
   * permanently by a MediaElementSource.
   */
  private async startPodcast(episodes: PodcastEpisode[]): Promise<boolean> {
    if (this.snap.media?.kind === "music") {
      this.yt?.stopVideo()
      this.set({ media: null })
    }
    this.disposePodcast()
    const token = this.podcastToken
    for (const episode of episodes.slice(0, 3)) {
      if (token !== this.podcastToken) return false
      const audio = new Audio()
      audio.preload = "auto"
      audio.volume = this.ducked ? 0.2 : 1
      this.set({
        media: {
          kind: "podcast",
          episode,
          playing: false,
          loading: true,
          blocked: false,
        },
        progress: { current: 0, duration: episode.durationSec ?? 0 },
      })
      const ready = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 10_000)
        audio.oncanplay = () => {
          clearTimeout(timer)
          resolve(true)
        }
        audio.onerror = () => {
          clearTimeout(timer)
          resolve(false)
        }
        audio.src = episode.audioUrl
      })
      audio.oncanplay = null
      if (token !== this.podcastToken) {
        audio.removeAttribute("src")
        return false
      }
      if (!ready) {
        audio.removeAttribute("src")
        audio.load()
        continue
      }
      this.podcastAudio = audio
      audio.onended = () => {
        const m = this.snap.media
        if (m?.kind === "podcast") this.set({ media: { ...m, playing: false } })
      }
      audio.onpause = () => {
        const m = this.snap.media
        if (m?.kind === "podcast" && m.playing && audio === this.podcastAudio)
          this.set({ media: { ...m, playing: false } })
      }
      audio.onplay = () => {
        const m = this.snap.media
        if (m?.kind === "podcast" && !m.playing)
          this.set({ media: { ...m, playing: true, blocked: false } })
      }
      let blocked = false
      try {
        await audio.play()
      } catch {
        blocked = true
      }
      this.set({
        media: {
          kind: "podcast",
          episode,
          playing: !blocked,
          loading: false,
          blocked,
        },
        caption: { kind: "nowplaying", text: episode.title, sub: episode.show },
      })
      this.mic.setHot(!blocked)
      return true
    }
    this.set({ media: null })
    return false
  }
}
