"use client"

import { useEffect, useRef } from "react"
import { ExternalLink, Newspaper, X } from "lucide-react"
import { stationById } from "@/aira/stations"
import type { Turn } from "../controller"

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

export function TranscriptDrawer({
  turns,
  onClose,
}: {
  turns: Turn[]
  onClose: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [turns.length])

  return (
    <section
      aria-label="Conversation transcript"
      className="aira-slide-up aira-glass fixed left-1/2 z-30 w-[min(92vw,500px)] -translate-x-1/2 rounded-2xl bottom-[calc(var(--safe-bottom)+92px)]"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-[11px] tracking-[0.2em] text-white/50">
          CONVERSATION LOG
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close transcript"
          className="-mr-2 grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <X size={15} />
        </button>
      </header>
      <div
        ref={listRef}
        className="aira-scroll aira-selectable max-h-[46vh] space-y-4 overflow-y-auto px-4 py-4"
      >
        {turns.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/45">
            No conversation yet. Tap the waves or the mic to talk.
          </p>
        ) : (
          turns.map((turn) =>
            turn.speaker === "activity" ? (
              <div
                key={turn.id}
                className="aira-fade-in rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <p className="flex items-center gap-2 text-[11px] tracking-wider text-white/55">
                  <Newspaper size={13} className="aira-hue-text" aria-hidden />
                  {turn.text}
                </p>
                {turn.links && turn.links.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {turn.links.map((l) => (
                      <li key={l.url}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-start gap-2 text-[13px] leading-snug text-white/75 hover:text-white"
                        >
                          <ExternalLink
                            size={12}
                            className="mt-[3px] shrink-0 text-white/35 group-hover:text-white/70"
                          />
                          <span>
                            {l.title}
                            {l.source && (
                              <span className="text-white/35">
                                {" "}
                                · {l.source}
                              </span>
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div key={turn.id} className="aira-fade-in">
                <p className="flex items-baseline gap-2 text-[10px] tracking-[0.18em]">
                  <span
                    className={
                      turn.speaker === "rj" ? "aira-hue-text" : "text-white/40"
                    }
                  >
                    {turn.speaker === "rj"
                      ? stationById(turn.stationId).rj.toUpperCase()
                      : "YOU"}
                  </span>
                  <span className="text-white/25">{time(turn.ts)}</span>
                </p>
                <p
                  className={`mt-1 text-sm leading-relaxed ${
                    turn.speaker === "rj"
                      ? "text-white/90"
                      : "text-white/55 italic"
                  }`}
                >
                  {turn.text}
                </p>
              </div>
            ),
          )
        )}
      </div>
    </section>
  )
}
