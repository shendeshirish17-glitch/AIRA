"use client"

import { VIBES, type VibeId } from "@/aira/stations"

export function VibeSelector({
  value,
  onChange,
}: {
  value: VibeId
  onChange: (id: VibeId) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Vibe"
      className="flex justify-center gap-1.5 md:flex-col md:items-start md:justify-start"
    >
      {VIBES.map((v) => {
        const active = v.id === value
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={v.caption}
            onClick={() => onChange(v.id)}
            className={`rounded-full border px-2.5 py-1 text-[10px] tracking-wider whitespace-nowrap transition-all duration-200 ${
              active
                ? "border-white/60 bg-white/5 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}
