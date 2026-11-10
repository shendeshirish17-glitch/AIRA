"use client"

/** Owns the YouTube iframe lifecycle: created on mount, destroyed on unmount. */
// YT replaces its target node with an iframe, so give it a node React does not own.
/* Icon sits underneath so a failed artwork load reveals it. */

import { useEffect, useRef } from "react"
import {
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Podcast,
  SkipForward,
  X,
} from "lucide-react"
import type { AiraController, MediaState, Snapshot } from "../controller"
import { Scrubber } from "./Scrubber"

const iconBtn =
  "grid size-9 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"

const fmtDur = (s?: number) => {
  if (!s) return null
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`
}
function YouTubeFrame({ controller }: { controller: AiraController }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = host.current
    if (!container) return
    const target = document.createElement("div")
    container.appendChild(target)
    controller.mountYouTube(target)
    return () => {
      controller.unmountYouTube()
      container.replaceChildren()
    }
  }, [controller])
  return (
    <div
      ref={host}
      aria-hidden="true"
      className="absolute -left-[9999px] -top-[9999px] h-px w-px overflow-hidden opacity-0 pointer-events-none [&_iframe]:h-full [&_iframe]:w-full"
    />
  )
}

export function MediaCard({
  controller,
  media,
  progress,
}: {
  controller: AiraController
  media: NonNullable<MediaState>
  progress: Snapshot["progress"]
}) {
  if (media.kind === "music") {
    return <YouTubeFrame controller={controller} />
  }

  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const playing = media.playing
  const toggle = (
    <button
      type="button"
      className={iconBtn}
      onClick={() => controller.togglePlay()}
      aria-label={playing ? "Pause" : "Play"}
      disabled={media.loading}
    >
      {media.loading ? (
        <Loader2 size={16} className="aira-spin" />
      ) : playing ? (
        <Pause size={16} />
      ) : (
        <Play size={16} />
      )}
    </button>
  )
  const close = (
    <button
      type="button"
      className={iconBtn}
      onClick={() => controller.stopMedia()}
      aria-label="Close player"
    >
      <X size={16} />
    </button>
  )

  return (
    <section
      aria-label="Podcast player"
      onPointerDown={stop}
      className="aira-fade-in aira-glass pointer-events-auto w-[min(84vw,356px)] overflow-hidden rounded-2xl"
    >
      <div className="flex gap-3 p-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-white/5">
          {}
          <Podcast
            size={22}
            className="absolute inset-0 m-auto text-white/40"
            aria-hidden
          />
          {media.episode.artwork && (
            <img
              src={media.episode.artwork}
              alt=""
              className="relative size-full object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-snug text-white/90">
                {media.episode.title}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/45">
                {media.episode.show}
                {fmtDur(media.episode.durationSec) &&
                  ` · ${fmtDur(media.episode.durationSec)}`}
              </p>
            </div>
            {toggle}
            {close}
          </div>
          {media.episode.description && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-white/40">
              {media.episode.description}
            </p>
          )}
          {media.episode.link && (
            <a
              href={media.episode.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
            >
              Episode page <ExternalLink size={11} />
            </a>
          )}
          {media.blocked && (
            <p className="mt-1 text-[11px] text-amber-200/80">
              Playback was blocked. Press play to start.
            </p>
          )}
        </div>
      </div>
      <div className="px-3 pb-1.5">
        <Scrubber
          current={progress.current}
          duration={progress.duration}
          onSeek={(f) => controller.seek(f)}
        />
      </div>
    </section>
  )
}
