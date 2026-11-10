"use client"

import { AlertTriangle, Music2 } from "lucide-react"
import type { Caption as CaptionT } from "../controller"

export function Caption({
  caption,
  hint,
}: {
  caption: CaptionT
  hint: string | null
}) {
  const key = `${caption.kind}:${caption.text}`
  return (
    <div className="pointer-events-none flex min-h-[56px] w-full flex-col items-center justify-end gap-2 text-center">
      {hint && (
        <p className="aira-fade-in rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] leading-snug text-zinc-300">
          {hint}
        </p>
      )}
      <div key={key} className="aira-fade-in" role="status" aria-live="polite">
        {caption.kind === "rj" && (
          <p className="text-[17px] leading-relaxed text-white md:text-lg">
            {caption.text}
          </p>
        )}
        {caption.kind === "user" && (
          <p className="text-[17px] leading-relaxed text-zinc-300 italic md:text-lg">
            “{caption.text}”
          </p>
        )}
        {caption.kind === "status" && (
          <p className="text-[15px] leading-relaxed text-zinc-400">
            {caption.text}
          </p>
        )}
        {caption.kind === "nowplaying" && (
          <p className="flex items-center justify-center gap-2 text-[15px] leading-relaxed text-white">
            <Music2 size={15} className="aira-hue-text shrink-0" aria-hidden />
            <span className="text-zinc-400">Now playing ·</span>
            <span className="line-clamp-1">{caption.text}</span>
          </p>
        )}
        {caption.kind === "error" && (
          <p className="flex items-start justify-center gap-2 text-[15px] leading-relaxed text-rose-300">
            <AlertTriangle
              size={16}
              className="mt-[3px] shrink-0"
              aria-hidden
            />
            <span>{caption.text}</span>
          </p>
        )}
      </div>
    </div>
  )
}
