"use client"

import { useRef, useState } from "react"

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return "0:00"
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, "0")
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

export function Scrubber({
  current,
  duration,
  onSeek,
}: {
  current: number
  duration: number
  onSeek: (fraction: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const known = duration > 0
  const frac = drag ?? (known ? Math.min(1, current / duration) : 0)
  const at = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    return r ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0
  }
  return (
    <div className="flex items-center gap-2 text-[10px] tabular-nums text-white/45">
      <span className="w-9 text-right">
        {fmt(drag != null ? drag * duration : current)}
      </span>
      <div
        ref={ref}
        role="slider"
        tabIndex={known ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${fmt(current)} of ${fmt(duration)}`}
        aria-disabled={!known}
        data-active={drag != null}
        className="aira-scrub flex-1"
        onPointerDown={(e) => {
          if (!known) return
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(at(e.clientX))
        }}
        onPointerMove={(e) => {
          if (drag != null) setDrag(at(e.clientX))
        }}
        onPointerUp={(e) => {
          if (drag == null) return
          onSeek(at(e.clientX))
          setDrag(null)
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (!known) return
          const step =
            e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0
          if (!step) return
          e.preventDefault()
          e.stopPropagation()
          onSeek((current + step) / duration)
        }}
      >
        <div className="aira-scrub-fill" style={{ width: `${frac * 100}%` }} />
        <div className="aira-scrub-knob" style={{ left: `${frac * 100}%` }} />
      </div>
      <span className="w-9">{known ? fmt(duration) : "--:--"}</span>
    </div>
  )
}
