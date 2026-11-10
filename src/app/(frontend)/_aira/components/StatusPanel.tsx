"use client"

import { X } from "lucide-react"
import type { ProviderStatus } from "@/aira/protocol"
import type { Snapshot } from "../controller"

type Tone = "native" | "fallback" | "off"
const dot: Record<Tone, string> = {
  native: "bg-emerald-400",
  fallback: "bg-amber-300",
  off: "bg-white/25",
}

function rows(
  s: ProviderStatus,
  snap: Snapshot,
): Array<{ name: string; label: string; tone: Tone }> {
  const stt =
    s.stt.mode === "prisma"
      ? { label: s.stt.label, tone: "native" as const }
      : snap.sttMode === "none"
        ? {
            label: "Unavailable in this browser (typing still works)",
            tone: "off" as const,
          }
        : { label: s.stt.label, tone: "fallback" as const }
  const tts =
    snap.voiceMode === "browser" && s.tts.mode === "timbre"
      ? {
          label: "Timbre failed; using browser voice",
          tone: "fallback" as const,
        }
      : {
          label: s.tts.label,
          tone:
            s.tts.mode === "timbre" ? "native" as const : "fallback" as const,
        }
  return [
    { name: "Speech in", ...stt },
    { name: "Voice out", ...tts },
    {
      name: "Brain",
      label: s.llm.label,
      tone: s.llm.mode === "evon" ? "native" : "fallback",
    },
    {
      name: "Music",
      label: s.music.label,
      tone: s.music.mode === "youtube" ? "native" : "off",
    },
    {
      name: "Podcasts",
      label: s.podcasts.label,
      tone: s.podcasts.mode === "podcastindex" ? "native" : "fallback",
    },
    { name: "News", label: s.news.label, tone: "native" },
  ]
}

export function StatusPanel({
  snap,
  onClose,
}: {
  snap: Snapshot
  onClose: () => void
}) {
  return (
    <section
      aria-label="Provider status"
      className="aira-fade-in aira-glass fixed right-4 z-40 w-[min(88vw,320px)] rounded-2xl top-[calc(var(--safe-top)+44px)]"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="text-[11px] tracking-[0.2em] text-white/50">
          ON-AIR SYSTEMS
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close status"
          className="-mr-2 grid size-8 place-items-center rounded-full text-white/50 hover:bg-white/5 hover:text-white"
        >
          <X size={15} />
        </button>
      </header>
      {snap.status ? (
        <>
          <ul className="space-y-2.5 px-4 py-3">
            {rows(snap.status, snap).map((r) => (
              <li
                key={r.name}
                className="flex items-start gap-2.5 text-[12px] leading-snug"
              >
                <span
                  className={`mt-[5px] size-1.5 shrink-0 rounded-full ${dot[r.tone]}`}
                  aria-hidden
                />
                <span className="w-[72px] shrink-0 text-white/45">{r.name}</span>
                <span className="text-white/80">{r.label}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-white/10 px-4 py-2.5 text-[11px] leading-relaxed">
            <p className="text-white/45">Missing provider variables</p>
            <p className="mt-1 break-words text-white/75">
              {snap.status.missingVariables.length
                ? snap.status.missingVariables.join(", ")
                : "None"}
            </p>
          </div>
        </>
      ) : (
        <p className="px-4 py-3 text-[12px] text-white/45">
          Checking providers…
        </p>
      )}
      <p className="border-t border-white/10 px-4 py-2.5 text-[11px] leading-relaxed text-white/40">
        Green is the native provider, amber a fallback. Headphones help
        hands-free mode avoid hearing AIRa.
      </p>
    </section>
  )
}
