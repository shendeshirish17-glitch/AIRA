"use client"
/** Space/arrows must not hijack typing, links, sliders, or the YouTube iframe. */
// Exactly one media card may mount (each owns a YouTube player), so its
// slot is picked here: docked right on wide screens, in the column below.
/* z-0 starfield + glow, z-10 waveform/dial (see Waveform) */ /* z-20 content layer. Non-interactive by default so empty space falls
          through to the waveform (drag to tune, tap to talk). */ /* Frequency readout */ /* Dialogue zone: frosted scrim keeps tags and captions legible */ /* Lower-middle band reserved for the waveform (drawn at z-10) */ /* Tuning dial slot (drawn on canvas) */ /* Vibes: vertical bottom-left on md+, backed so dial ticks never cut through */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  Activity,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Radio,
} from "lucide-react"
import { LANGUAGES, STATIONS, stationById, vibeById } from "@/aira/stations"
import { AiraController, type Levels } from "./controller"
import { Caption } from "./components/Caption"
import { Controls } from "./components/Controls"
import { MediaCard } from "./components/MediaCard"
import { StatusPanel } from "./components/StatusPanel"
import { TranscriptDrawer } from "./components/TranscriptDrawer"
import { VibeSelector } from "./components/VibeSelector"
import { Waveform, type Tuner } from "./components/Waveform"
import "./aira.css"

const DEV_LEVELS: Array<keyof Levels> = [
  "rj",
  "user",
  "media",
  "mediaReactive",
  "processing",
  "error",
]
function ownsKeys(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest(".aira-mic")) return false
  return !!target.closest(
    'input, textarea, select, button, a, iframe, [role="slider"], [contenteditable="true"]',
  )
}

export function AiraApp({ fontClass }: { fontClass: string }) {
  const [controller] = useState(() => new AiraController())
  const snap = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState("")
  const [reducedMotion, setReducedMotion] = useState(false)
  const [docked, setDocked] = useState(false)
  const station = stationById(snap.stationId)
  const vibe = vibeById(snap.vibeId)
  const tuner = useRef<Tuner>({
    display: station.freq,
    drag: 0,
    dragSmooth: 0,
    scatter: 0,
  })
  const freqEl = useRef<HTMLSpanElement>(null)
  const bandEl = useRef<HTMLDivElement>(null)
  const dialEl = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const spaceAt = useRef(0)
  const stationIdx = STATIONS.findIndex((s) => s.id === station.id)
  const hue = station.hue + vibe.hueShift

  useEffect(() => {
    controller.init()
    const params = new URLSearchParams(window.location.search)
    const level = params.get("level") as keyof Levels | null
    if (params.get("dev") === "1" && level && DEV_LEVELS.includes(level))
      controller.setSimulation(level)
    return () => {
      controller.destroy()
    }
  }, [controller])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const lg = window.matchMedia("(min-width: 1280px)")
    const sync = () => {
      setReducedMotion(mq.matches)
      setDocked(lg.matches)
    }
    sync()
    mq.addEventListener("change", sync)
    lg.addEventListener("change", sync)
    return () => {
      mq.removeEventListener("change", sync)
      lg.removeEventListener("change", sync)
    }
  }, [])

  useEffect(() => {
    if (typing) inputRef.current?.focus()
  }, [typing])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTranscriptOpen(false)
        setStatusOpen(false)
        setTyping(false)
        return
      }
      if (ownsKeys(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault()
        controller.tune(e.key === "ArrowLeft" ? -1 : 1)
      } else if (e.key === " ") {
        e.preventDefault()
        if (e.repeat) return
        spaceAt.current = performance.now()
        void controller.talk()
      } else if (e.key === "/") {
        e.preventDefault()
        setTyping(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== " " || !spaceAt.current) return
      if (performance.now() - spaceAt.current > 450) controller.release()
      spaceAt.current = 0
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [controller])

  const media = snap.media
  const card = media?.kind === "podcast" && (
    <MediaCard controller={controller} media={media} progress={snap.progress} />
  )
  const lang = LANGUAGES[snap.lang]
  const inline = !!card && !docked
  const tagCls =
    "rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[10px] tracking-widest text-zinc-300"

  return (
    <main
      className={`aira-root ${fontClass}`}
      style={{ "--aira-hue": hue } as React.CSSProperties}
      aria-label={`AIRa radio, ${station.freq} ${station.name}`}
    >
      <h1 className="sr-only">AIRa · multilingual AI radio</h1>

      {media?.kind === "music" && (
        <MediaCard
          controller={controller}
          media={media}
          progress={snap.progress}
        />
      )}

      {}
      <Waveform
        controller={controller}
        station={station}
        vibe={vibe}
        tuner={tuner}
        freqEl={freqEl}
        bandEl={bandEl}
        dialEl={dialEl}
        reducedMotion={reducedMotion}
        onTap={() => void controller.talk()}
        onTune={(d) => controller.tune(d)}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-700"
        style={{
          opacity: vibe.warmth * 0.12,
          background: `radial-gradient(100% 100% at 50% 100%, hsl(${hue}, 80%, 50%), transparent 60%)`,
        }}
      />
      {snap.interruptAt > 0 && (
        <div
          key={snap.interruptAt}
          aria-hidden
          className="aira-flash pointer-events-none fixed inset-0 z-10"
          style={{
            background: `radial-gradient(60% 30% at 50% 62%, hsla(${hue},100%,75%,0.5), transparent 70%)`,
          }}
        />
      )}

      {}
      <div className="pointer-events-none fixed inset-0 z-20 flex flex-col overflow-hidden pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+16px)]">
        <header className="flex shrink-0 items-start justify-between px-4 text-xs">
          <p className="flex items-center gap-2 text-zinc-200">
            <span
              className={`size-2 rounded-full ${
                snap.phase === "error" ? "bg-rose-400" : "bg-white"
              } aira-blink`}
              aria-hidden
            />
            <span>{station.rj} · on air</span>
          </p>
          <div className="flex flex-col items-end gap-1.5">
            <p className="flex items-center gap-1.5 text-zinc-400">
              <Radio size={12} aria-hidden />
              <span className="tracking-wider">AIRa</span>
            </p>
            <button
              type="button"
              onClick={() => setStatusOpen((o) => !o)}
              aria-expanded={statusOpen}
              aria-label={`Language ${lang.label}. Show provider status`}
              className="pointer-events-auto -mr-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] tracking-widest text-zinc-300 transition-colors hover:text-white"
            >
              {lang.short}
              <Activity size={11} aria-hidden />
            </button>
          </div>
        </header>

        {}
        <section
          className={`flex shrink-0 flex-col items-center transition-[margin] duration-500 ${
            inline ? "mt-1" : "mt-[clamp(12px,5vh,56px)]"
          }`}
        >
          <div className="flex items-center gap-1 sm:gap-4">
            <button
              type="button"
              aria-label="Previous station"
              disabled={stationIdx <= 0}
              onClick={() => controller.tune(-1)}
              className="pointer-events-auto grid size-10 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white disabled:opacity-0"
            >
              <ChevronLeft size={22} />
            </button>
            <span
              ref={freqEl}
              aria-hidden
              className={`leading-none tracking-tight text-transparent tabular-nums transition-[font-size] duration-500 [-webkit-text-stroke:1.2px_rgba(255,255,255,0.5)] ${
                inline
                  ? "text-[clamp(52px,min(15vw,11vh),230px)]"
                  : "text-[clamp(64px,min(21vw,22vh),230px)]"
              }`}
            >
              {station.freq.toFixed(1)}
            </span>
            <button
              type="button"
              aria-label="Next station"
              disabled={stationIdx >= STATIONS.length - 1}
              onClick={() => controller.tune(1)}
              className="pointer-events-auto grid size-10 place-items-center rounded-full text-zinc-500 transition-colors hover:text-white disabled:opacity-0"
            >
              <ChevronRight size={22} />
            </button>
          </div>
          <p className="mt-1 text-[13px] tracking-widest text-zinc-400">
            MHz · {station.name}
          </p>
        </section>

        {}
        <section
          aria-label="Now on air"
          className={`pointer-events-auto mx-auto mt-[clamp(10px,3vh,28px)] flex shrink-0 flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/60 p-4 shadow-2xl backdrop-blur-md ${
            card && docked
              ? "w-[min(600px,calc(100vw-848px))]"
              : "w-[min(92vw,600px)]"
          }`}
        >
          <ul
            className={`flex flex-wrap justify-center gap-2 ${
              inline ? "[@media(max-height:720px)]:hidden" : ""
            }`}
            aria-label="Station tags"
          >
            {station.tags.map((tag) => (
              <li key={tag} className={tagCls}>
                {tag}
              </li>
            ))}
            <li className={`${tagCls} aira-hue-text border-current/30`}>
              {vibe.label.toUpperCase()}
            </li>
          </ul>
          <Caption caption={snap.caption} hint={snap.hint} />
        </section>

        {inline && <div className="mx-auto mt-3 shrink-0">{card}</div>}

        <div
          className={`pointer-events-auto mt-3 shrink-0 md:hidden ${
            inline ? "[@media(max-height:720px)]:hidden" : ""
          }`}
        >
          <VibeSelector
            value={snap.vibeId}
            onChange={(id) => controller.setVibe(id)}
          />
        </div>

        {}
        <div ref={bandEl} aria-hidden className="mt-2 min-h-[72px] flex-1" />
        {}
        <div ref={dialEl} aria-hidden className="h-[54px] shrink-0" />

        <div className="pointer-events-auto mt-2 shrink-0">
          <Controls
            controller={controller}
            snap={snap}
            transcriptOpen={transcriptOpen}
            onToggleTranscript={() => {
              setTyping(false)
              setTranscriptOpen((o) => !o)
            }}
            typing={typing}
            onToggleTyping={() => {
              setTranscriptOpen(false)
              setTyping((t) => !t)
            }}
          />
        </div>
      </div>

      {card && docked && (
        <div className="fixed top-1/2 right-6 z-20 -translate-y-1/2">
          {card}
        </div>
      )}
      {}
      <div className="fixed bottom-[calc(var(--safe-bottom)+20px)] left-4 z-20 hidden rounded-xl border border-white/10 bg-black/80 p-1.5 shadow-2xl md:block">
        <VibeSelector
          value={snap.vibeId}
          onChange={(id) => controller.setVibe(id)}
        />
      </div>

      {typing && (
        <form
          className="aira-slide-up aira-glass fixed bottom-[calc(var(--safe-bottom)+92px)] left-1/2 z-30 flex w-[min(92vw,500px)] -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4"
          onSubmit={(e) => {
            e.preventDefault()
            const text = draft.trim()
            if (!text || snap.phase === "processing") return
            controller.submitText(text)
            setDraft("")
          }}
        >
          <label htmlFor="aira-input" className="sr-only">
            Type a request
          </label>
          <input
            id="aira-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            autoComplete="off"
            placeholder={`Ask ${station.rj}… “play Arijit”, “news in Marathi”`}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white placeholder:text-white/35 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || snap.phase === "processing"}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={16} />
          </button>
        </form>
      )}

      {transcriptOpen && !typing && (
        <TranscriptDrawer
          turns={snap.turns}
          onClose={() => setTranscriptOpen(false)}
        />
      )}
      {statusOpen && (
        <StatusPanel snap={snap} onClose={() => setStatusOpen(false)} />
      )}
    </main>
  )
}
