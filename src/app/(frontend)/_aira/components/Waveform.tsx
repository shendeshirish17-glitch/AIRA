"use client"

import { useEffect, useRef } from "react"
import { STATIONS, type Station, type Vibe } from "@/aira/stations"
import type { AiraController } from "../controller"

/** Mutable tuning state shared between the canvas loop and pointer handlers. */
export interface Tuner {
  display: number
  drag: number
  dragSmooth: number
  scatter: number
}

interface Props {
  controller: AiraController
  station: Station
  vibe: Vibe
  tuner: React.RefObject<Tuner>
  freqEl: React.RefObject<HTMLSpanElement | null>
  /** Layout slot the waves are confined to (lower-middle band). */
  bandEl: React.RefObject<HTMLDivElement | null>
  /** Layout slot whose top edge is the dial's tuning line. */
  dialEl: React.RefObject<HTMLDivElement | null>
  reducedMotion: boolean
  onTap: () => void
  onTune: (delta: number) => void
}

const LAYERS = 6
const gauss = (u: number, c: number, s: number) =>
  Math.exp(-(((u - c) / s) ** 2))

function drawDial(
  ctx: CanvasRenderingContext2D,
  fnow: number,
  W: number,
  ry: number,
  hue: number,
  font: string,
) {
  const per = W / 7
  ctx.font = `11px ${font}`
  ctx.textAlign = "center"
  ctx.lineWidth = 1
  for (let f = Math.ceil((fnow - 4) * 2) / 2; f <= fnow + 4; f += 0.5) {
    const x = W / 2 + (f - fnow) * per
    const major = Math.abs(f - Math.round(f)) < 0.01
    const a = Math.max(0, 1 - Math.abs(x - W / 2) / (W / 2))
    ctx.strokeStyle = `rgba(255,255,255,${0.14 + 0.5 * a})`
    ctx.beginPath()
    ctx.moveTo(x, ry)
    ctx.lineTo(x, ry + (major ? 16 : 8))
    ctx.stroke()
    if (major && Math.round(f) % 2 === 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * a})`
      ctx.fillText(String(Math.round(f)), x, ry + 32)
    }
  }
  for (const s of STATIONS) {
    const x = W / 2 + (s.freq - fnow) * per
    if (x > 0 && x < W) {
      ctx.fillStyle = `hsl(${s.hue}, 95%, 62%)`
      ctx.beginPath()
      ctx.arc(x, ry - 9, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 2
  ctx.shadowColor = `hsl(${hue}, 100%, 60%)`
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.moveTo(W / 2, ry - 18)
  ctx.lineTo(W / 2, ry + 22)
  ctx.stroke()
  ctx.shadowBlur = 0
}

/**
 * Layers: a full-screen z-0 starfield/glow canvas, and a z-10 waveform + dial
 * canvas sized to just the band-to-dial strip (two full-screen canvases are
 * costly to composite on large or software-rendered screens). Waves are
 * confined to `bandEl` with feathered edges so they never cross the frequency
 * readout, dialogue scrim, or controls (z-20). A paint-free z-10 surface
 * handles drag-to-tune and tap-to-talk.
 */
export function Waveform(props: Props) {
  const bgRef = useRef<HTMLCanvasElement>(null)
  const fgRef = useRef<HTMLCanvasElement>(null)
  const hitRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  // A burst of static scatter whenever the station changes (not on mount).
  const firstStation = useRef(props.station.id)
  useEffect(() => {
    if (firstStation.current === props.station.id) return
    firstStation.current = props.station.id
    props.tuner.current.scatter = 1
  }, [props.station.id, props.tuner])

  useEffect(() => {
    const bg = bgRef.current
    const fg = fgRef.current
    const bctx = bg?.getContext("2d")
    const ctx = fg?.getContext("2d")
    if (!bg || !fg || !bctx || !ctx) return
    let W = 0
    let H = 0
    let font = "ui-monospace, monospace"
    let raf = 0
    let dpr = 1
    // Viewport strip the waveform canvas currently covers.
    const strip = { top: Number.NaN, h: 0 }
    // Band geometry is eased so it glides when the layout reflows (media card).
    const band = { top: 0, h: 0, ready: false }
    const particles = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.4,
      v: Math.random() * 0.0005 + 0.0002,
    }))
    const env = { rj: 0, us: 0, media: 0, proc: 0, err: 0 }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = window.innerWidth
      H = window.innerHeight
      // The ambient layer is soft (glow + specks), so half resolution is
      // visually equivalent and a quarter of the raster/composite cost.
      const bs = dpr * 0.5
      bg.width = Math.round(W * bs)
      bg.height = Math.round(H * bs)
      bctx.setTransform(bs, 0, 0, bs, 0, 0)
      strip.top = Number.NaN
      font = getComputedStyle(fg).fontFamily || font
    }
    resize()
    window.addEventListener("resize", resize)

    const frame = (ms: number) => {
      const p = propsRef.current
      // Read layout first, before this frame's DOM write below.
      const br = p.bandEl.current?.getBoundingClientRect()
      const dialY =
        (p.dialEl.current?.getBoundingClientRect().top ?? H - 140) + 18
      const targetTop = br ? br.top : H * 0.45
      const targetH = br ? br.height : H * 0.25
      if (!band.ready || p.reducedMotion) {
        band.top = targetTop
        band.h = targetH
        band.ready = true
      } else {
        band.top += (targetTop - band.top) * 0.12
        band.h += (targetH - band.h) * 0.12
      }

      const t = ms / 1000
      const tn = p.tuner.current
      tn.display += (p.station.freq - tn.display) * 0.12
      tn.dragSmooth += (tn.drag - tn.dragSmooth) * 0.25
      tn.scatter *= 0.93
      if (p.freqEl.current)
        p.freqEl.current.textContent = (tn.display + tn.dragSmooth).toFixed(1)

      const lv = p.controller.getLevels(t)
      env.rj += (lv.rj - env.rj) * 0.14
      env.us += (lv.user - env.us) * 0.18
      env.media += (lv.mediaReactive - env.media) * 0.1
      env.proc += (lv.processing - env.proc) * 0.08
      env.err += (lv.error - env.err) * 0.2

      const all = Math.min(1, env.rj + env.us + env.media * 0.6 + env.proc * 0.25)
      const baseHue = p.station.hue + p.vibe.hueShift
      // Errors pull the palette toward red.
      const hue = baseHue + (((0 - baseHue + 540) % 360) - 180) * env.err * 0.85
      const sc = Math.max(tn.scatter, Math.abs(tn.dragSmooth) / 3, env.err * 0.15)
      const rm = p.reducedMotion
      const mid = band.top + band.h / 2

      // Re-fit the waveform canvas when the layout strip moves or resizes.
      const sTop = Math.max(0, Math.floor(targetTop) - 2)
      const sH = Math.min(H, Math.ceil(dialY + 40)) - sTop
      if (
        Number.isNaN(strip.top) ||
        Math.abs(sTop - strip.top) > 1 ||
        Math.abs(sH - strip.h) > 1
      ) {
        strip.top = sTop
        strip.h = Math.max(1, sH)
        fg.style.top = `${strip.top}px`
        fg.style.height = `${strip.h}px`
        fg.width = Math.round(W * dpr)
        fg.height = Math.round(strip.h * dpr)
      }

      // --- z-0: ambient glow + starfield ---
      bctx.globalCompositeOperation = "source-over"
      bctx.clearRect(0, 0, W, H)
      const glow = bctx.createRadialGradient(W / 2, mid, 0, W / 2, mid, Math.max(W, H) * 0.6)
      glow.addColorStop(0, `hsla(${hue}, 90%, 55%, ${0.07 + 0.3 * all})`)
      glow.addColorStop(1, "hsla(0,0%,0%,0)")
      bctx.fillStyle = glow
      bctx.fillRect(0, 0, W, H)
      bctx.globalCompositeOperation = "lighter"
      bctx.fillStyle = "#fff"
      for (const part of particles) {
        part.y -= part.v * (rm ? 0 : 1 + all * 7)
        if (part.y < 0) part.y = 1
        bctx.globalAlpha = 0.12 + 0.4 * all
        // At least one backing pixel so specks survive the downscale.
        const r = Math.max(part.r, 2 / dpr)
        bctx.fillRect(part.x * W, part.y * H, r, r)
      }
      bctx.globalAlpha = 1

      // --- z-10: waveform confined to the band ---
      // Draw in viewport coordinates; the transform offsets to the strip.
      ctx.setTransform(dpr, 0, 0, dpr, 0, -strip.top * dpr)
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, strip.top, W, strip.h)
      // Peak excursion stays inside the band (the envelope can exceed 1).
      const amp = Math.max(24, band.h * 0.34)
      const sp = rm ? 0 : p.station.speed * p.vibe.speedMult
      const k = p.station.k
      const procC = 0.5 + 0.38 * Math.sin(t * 2.2)
      for (let i = 0; i < LAYERS; i++) {
        ctx.beginPath()
        for (let x = 0; x <= W; x += 4) {
          const u = x / W
          const e =
            0.09 +
            0.03 * Math.sin(t * 0.9) +
            env.rj * gauss(u, 0.26, 0.3) +
            env.us * gauss(u, 0.74, 0.3) +
            env.media * (0.55 + 0.45 * gauss(u, 0.5, 0.5)) +
            env.proc * 0.16 * gauss(u, procC, 0.14)
          const y =
            mid +
            e * amp * Math.sin(u * k * 8 + t * sp + i * 0.75) * Math.cos(u * k * 3.2 - t * sp * 0.6 + i * 1.15) +
            e * amp * 0.25 * Math.sin(u * k * 15 - t * sp * 1.4 + i * 2) +
            (Math.random() - 0.5) * sc * band.h * 0.3
          if (x) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        }
        ctx.strokeStyle =
          i < 2 ? `hsla(${hue}, 95%, 70%, 0.75)` : `rgba(255,255,255,${0.25 + 0.5 * (i / LAYERS)})`
        ctx.lineWidth = 0.8 + (i % 3) * 0.5
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`
        ctx.shadowBlur = 14
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      if (sc > 0.02) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, sc)})`
        for (let i = 0; i < sc * 500; i++)
          ctx.fillRect(Math.random() * W, band.top + Math.random() * band.h, 1.5, 1.5)
      }
      // Feather the band: anything outside it fades to nothing.
      const fade = Math.min(28, band.h * 0.22)
      const mask = ctx.createLinearGradient(0, band.top, 0, band.top + band.h)
      const f = band.h > 0 ? fade / band.h : 0
      mask.addColorStop(0, "rgba(0,0,0,0)")
      mask.addColorStop(f, "rgba(0,0,0,1)")
      mask.addColorStop(1 - f, "rgba(0,0,0,1)")
      mask.addColorStop(1, "rgba(0,0,0,0)")
      ctx.globalCompositeOperation = "destination-in"
      ctx.fillStyle = mask
      ctx.fillRect(0, strip.top, W, strip.h)

      ctx.globalCompositeOperation = "source-over"
      drawDial(ctx, tn.display + tn.dragSmooth, W, dialY, hue, font)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [])

  // Drag sideways to tune, tap to talk. Listeners live on the z-10 hit surface
  // only; the z-20 content layer above keeps its own controls isolated.
  useEffect(() => {
    const cv = hitRef.current
    if (!cv) return
    let start: { x: number; y: number; t: number; id: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
      cv.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const tn = propsRef.current.tuner.current
      tn.drag = Math.max(-3.5, Math.min(3.5, (-dx / window.innerWidth) * 7))
      if (Math.abs(dx) > 20 && tn.scatter < 0.3) tn.scatter = 0.3
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      const dt = performance.now() - start.t
      start = null
      propsRef.current.tuner.current.drag = 0
      if (Math.abs(dx) > 50) propsRef.current.onTune(dx < 0 ? 1 : -1)
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 600) propsRef.current.onTap()
    }
    const cancel = () => {
      start = null
      propsRef.current.tuner.current.drag = 0
    }
    cv.addEventListener("pointerdown", down)
    cv.addEventListener("pointermove", move)
    cv.addEventListener("pointerup", up)
    cv.addEventListener("pointercancel", cancel)
    return () => {
      cv.removeEventListener("pointerdown", down)
      cv.removeEventListener("pointermove", move)
      cv.removeEventListener("pointerup", up)
      cv.removeEventListener("pointercancel", cancel)
    }
  }, [])

  return (
    <>
      <canvas
        ref={bgRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      />
      <canvas
        ref={fgRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-0 w-full"
      />
      <div
        ref={hitRef}
        aria-hidden="true"
        className="fixed inset-0 z-10 cursor-grab touch-none active:cursor-grabbing"
      />
    </>
  )
}
