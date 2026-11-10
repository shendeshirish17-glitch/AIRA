// One shared AudioContext for the whole app (mic analysis, TTS playback, effects).
let ctx: AudioContext | null = null

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (ctx && ctx.state !== "closed") return ctx
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    ctx = Ctor ? new Ctor({ latencyHint: "interactive" }) : null
  } catch {
    ctx = null
  }
  return ctx
}

/** Must be called from a user gesture at least once (autoplay policy). */
export async function unlockAudio(): Promise<void> {
  const ac = getAudioContext()
  if (ac && ac.state === "suspended") {
    try {
      await ac.resume()
    } catch {
      /* ignored: retried on the next gesture */
    }
  }
}

/** Short analog-radio static burst used when tuning. */
export function playStatic(durationSec = 0.25, gain = 0.12): void {
  const ac = getAudioContext()
  if (!ac) return
  if (ac.state === "suspended") void ac.resume()
  const n = Math.floor(ac.sampleRate * durationSec)
  const buffer = ac.createBuffer(1, n, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < n; i++)
    data[i] = (Math.random() * 2 - 1) * (1 - i / n) * gain
  const src = ac.createBufferSource()
  src.buffer = buffer
  src.connect(ac.destination)
  src.start()
}

/** RMS level (0..1, boosted for display) from an analyser's time-domain data. */
export function analyserLevel(
  analyser: AnalyserNode,
  buf: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 5)
}

/** Synthetic speech-like envelope for sources we cannot analyse. */
export function speechAmp(t: number): number {
  return Math.min(
    1,
    0.25 + 0.75 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1)),
  )
}
