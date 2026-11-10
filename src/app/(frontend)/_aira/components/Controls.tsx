"use client"

import { useRef } from "react"
import {
  AudioLines,
  Keyboard,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
} from "lucide-react"
import type { AiraController, Snapshot } from "../controller"

const side =
  "relative grid size-11 place-items-center rounded-full border border-white/10 text-white/65 transition-colors hover:border-white/25 hover:text-white aria-pressed:border-white/50 aria-pressed:bg-white/[0.07] aria-pressed:text-white"

const HOLD_MS = 450

export function Controls({
  controller,
  snap,
  transcriptOpen,
  onToggleTranscript,
  typing,
  onToggleTyping,
}: {
  controller: AiraController
  snap: Snapshot
  transcriptOpen: boolean
  onToggleTranscript: () => void
  typing: boolean
  onToggleTyping: () => void
}) {
  const pressAt = useRef(0)
  const { phase, mic } = snap
  const micBlocked =
    mic === "denied" || mic === "unavailable" || snap.sttMode === "none"
  const micLabel =
    phase === "capturing"
      ? "Stop and send"
      : phase === "speaking" || phase === "processing"
        ? "Interrupt and talk"
        : "Talk to AIRa (hold or tap)"

  return (
    <nav
      aria-label="Radio controls"
      className="flex items-center justify-center gap-3"
    >
      <button
        type="button"
        className={side}
        aria-pressed={snap.handsFree}
        aria-label={
          snap.handsFree ? "Turn hands-free off" : "Turn hands-free on"
        }
        title="Hands-free: AIRa listens continuously"
        onClick={() => void controller.toggleHandsFree()}
      >
        <AudioLines size={17} />
      </button>
      <button
        type="button"
        className={side}
        aria-pressed={transcriptOpen}
        aria-label="Transcript"
        title="Transcript"
        onClick={onToggleTranscript}
      >
        <MessageSquareText size={17} />
        {snap.turns.length > 0 && !transcriptOpen && (
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-white/70" />
        )}
      </button>

      <button
        type="button"
        data-phase={phase}
        aria-label={micLabel}
        title={micLabel}
        className="aira-mic relative grid size-16 place-items-center rounded-full border border-white/25 bg-white/[0.06] text-white shadow-[0_0_32px_-6px_hsl(var(--aira-hue)_95%_60%/0.6)] transition-transform active:scale-95 data-[phase=capturing]:border-white data-[phase=capturing]:bg-white data-[phase=capturing]:text-black"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          pressAt.current = performance.now()
          void controller.talk()
        }}
        onPointerUp={() => {
          if (pressAt.current && performance.now() - pressAt.current > HOLD_MS)
            controller.release()
          pressAt.current = 0
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void controller.talk()
          }
        }}
      >
        <span className="aira-mic-ring" />
        {phase === "processing" ? (
          <Loader2 size={24} className="aira-spin" />
        ) : phase === "capturing" ? (
          <Square size={18} fill="currentColor" />
        ) : micBlocked ? (
          <MicOff size={24} />
        ) : (
          <Mic size={24} />
        )}
      </button>

      <button
        type="button"
        className={side}
        aria-label={
          snap.media?.playing
            ? "Pause"
            : snap.media
              ? "Play"
              : "Play station music"
        }
        title={snap.media ? undefined : "Play station music"}
        onClick={() => controller.togglePlay()}
      >
        {snap.media?.playing ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <button
        type="button"
        className={side}
        aria-pressed={typing}
        aria-label="Type a request"
        title="Type a request ( / )"
        onClick={onToggleTyping}
      >
        <Keyboard size={17} />
      </button>
    </nav>
  )
}
