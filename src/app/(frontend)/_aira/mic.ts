// Microphone capture with an adaptive-threshold voice activity detector.
//   - ~20 ms frames from an AudioWorklet (ScriptProcessor fallback)
//   - ~400 ms preroll so the start of an utterance is never clipped
//   - speech start after ~160 ms of sustained voice, "confirmed" after ~400 ms
//   - stricter thresholds while AIRa or media is playing (echo/bleed)
//   - utterances end on trailing silence and are capped at 15 s
import { analyserLevel, getAudioContext } from "./audio"

export type VadMode = "off" | "handsfree" | "ptt"

export interface MicEvents {
  onSpeechStart(): void
  onSpeechConfirmed(): void
  onFalseStart(): void
  onUtterance(samples: Float32Array, sampleRate: number): void
  onNoSpeech(): void
}

const FRAME_MS = 20
const START_MS = 160
const CONFIRM_MS = 400
const PREROLL_MS = 400
const MAX_UTTERANCE_MS = 15_000
const PTT_NO_SPEECH_MS = 6000

const WORKLET = `
class AiraTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frame;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('aira-tap', AiraTap);
`

export class MicEngine {
  private stream: MediaStream | null = null
  private nodes: AudioNode[] = []
  private analyser: AnalyserNode | null = null
  private levelBuf: Uint8Array<ArrayBuffer> | null = null
  private rate = 48000
  private mode: VadMode = "off"
  private hot = false
  private endSilenceMs = 700

  // VAD state
  private floor = 0.008
  private preroll: Float32Array[] = []
  private segment: Float32Array[] = []
  private inSpeech = false
  private voicedRun = 0
  private unvoicedRun = 0
  private voicedTotal = 0
  private silenceRun = 0
  private confirmed = false
  private pttTimer: ReturnType<typeof setTimeout> | null = null
  private starting: Promise<void> | null = null

  constructor(private events: MicEvents) {}

  get active() {
    return this.stream !== null
  }
  get speaking() {
    return this.inSpeech
  }

  start(): Promise<void> {
    if (this.stream) return Promise.resolve()
    if (!this.starting)
      this.starting = this.open().finally(() => (this.starting = null))
    return this.starting
  }

  private async open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported")
    const ac = getAudioContext()
    if (!ac) throw new Error("unsupported")
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
    if (ac.state === "suspended") await ac.resume().catch(() => undefined)
    this.rate = ac.sampleRate
    const source = ac.createMediaStreamSource(stream)
    const analyser = ac.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    // The capture node must reach the destination to keep being pulled; a
    // zero-gain node keeps the mic inaudible.
    const sink = ac.createGain()
    sink.gain.value = 0
    sink.connect(ac.destination)
    const frame = Math.round((this.rate * FRAME_MS) / 1000)
    let tap: AudioNode
    try {
      const url = URL.createObjectURL(
        new Blob([WORKLET], { type: "application/javascript" }),
      )
      await ac.audioWorklet
        .addModule(url)
        .finally(() => URL.revokeObjectURL(url))
      const node = new AudioWorkletNode(ac, "aira-tap", {
        processorOptions: { frame },
      })
      node.port.onmessage = (e: MessageEvent<Float32Array>) =>
        this.onFrame(e.data)
      tap = node
    } catch {
      const node = ac.createScriptProcessor(1024, 1, 1)
      node.onaudioprocess = (e) =>
        this.onFrame(new Float32Array(e.inputBuffer.getChannelData(0)))
      tap = node
    }
    source.connect(tap)
    tap.connect(sink)
    this.stream = stream
    this.analyser = analyser
    this.levelBuf = new Uint8Array(analyser.fftSize)
    this.nodes = [source, analyser, tap, sink]
    stream.getAudioTracks()[0]?.addEventListener("ended", () => this.stop())
  }

  stop() {
    this.clearPttTimer()
    for (const n of this.nodes) {
      try {
        n.disconnect()
      } catch {
        /* already disconnected */
      }
      if (n instanceof AudioWorkletNode) n.port.onmessage = null
    }
    this.nodes = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser = null
    this.mode = "off"
    this.resetSegment()
  }

  setMode(mode: VadMode) {
    this.mode = mode
    this.endSilenceMs = mode === "ptt" ? 900 : 700
    this.resetSegment()
    this.clearPttTimer()
    if (mode === "ptt") {
      this.pttTimer = setTimeout(() => {
        if (this.mode === "ptt" && !this.inSpeech) {
          this.mode = "off"
          this.events.onNoSpeech()
        }
      }, PTT_NO_SPEECH_MS)
    }
  }

  getMode() {
    return this.mode
  }

  /** Raise thresholds while AIRa's voice or media is audible. */
  setHot(hot: boolean) {
    this.hot = hot
  }

  /** Push-to-talk released early: finish now. */
  flush() {
    if (this.inSpeech && this.voicedTotal >= 200) this.emitUtterance()
    else {
      const wasPtt = this.mode === "ptt"
      this.resetSegment()
      if (wasPtt) {
        this.mode = "off"
        this.clearPttTimer()
        this.events.onNoSpeech()
      }
    }
  }

  getLevel(): number {
    return this.analyser && this.levelBuf
      ? analyserLevel(this.analyser, this.levelBuf)
      : 0
  }

  private clearPttTimer() {
    if (this.pttTimer) clearTimeout(this.pttTimer)
    this.pttTimer = null
  }

  private resetSegment() {
    this.segment = []
    this.inSpeech = false
    this.voicedRun = 0
    this.unvoicedRun = 0
    this.voicedTotal = 0
    this.silenceRun = 0
    this.confirmed = false
  }

  private onFrame(frame: Float32Array) {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    const ms = (frame.length / this.rate) * 1000

    const factor = this.hot ? 4.5 : 3
    const minAbs = this.hot ? 0.03 : 0.012
    const threshold = Math.max(minAbs, this.floor * factor)
    const voiced = rms > threshold

    // Adapt the noise floor only outside speech, and only towards quiet-ish frames.
    if (!this.inSpeech && !voiced)
      this.floor = this.floor * 0.97 + Math.min(rms, this.floor * 2) * 0.03
    this.floor = Math.min(0.05, Math.max(0.002, this.floor))

    if (this.mode === "off") {
      this.preroll = []
      return
    }

    if (!this.inSpeech) {
      this.preroll.push(frame)
      const maxFrames = Math.ceil(PREROLL_MS / ms)
      if (this.preroll.length > maxFrames) this.preroll.shift()
      if (voiced) {
        this.voicedRun += ms
        this.unvoicedRun = 0
      } else if ((this.unvoicedRun += ms) > 2 * FRAME_MS) {
        this.voicedRun = 0
      }
      if (this.voicedRun >= START_MS) {
        this.inSpeech = true
        this.segment = this.preroll
        this.preroll = []
        this.voicedTotal = this.voicedRun
        this.silenceRun = 0
        this.clearPttTimer()
        this.events.onSpeechStart()
      }
      return
    }

    this.segment.push(frame)
    if (voiced) {
      this.voicedTotal += ms
      this.silenceRun = 0
    } else {
      this.silenceRun += ms
    }
    if (!this.confirmed && this.voicedTotal >= CONFIRM_MS) {
      this.confirmed = true
      this.events.onSpeechConfirmed()
    }
    const duration = this.segment.length * ms
    if (duration >= MAX_UTTERANCE_MS) {
      this.emitUtterance()
    } else if (this.silenceRun >= this.endSilenceMs) {
      const minVoiced = this.hot ? CONFIRM_MS : 200
      if (this.voicedTotal >= minVoiced) this.emitUtterance()
      else {
        this.resetSegment()
        this.events.onFalseStart()
      }
    }
  }

  private emitUtterance() {
    // Trim most of the trailing silence but keep ~200 ms of tail.
    const ms = ((this.segment[0]?.length ?? 1) / this.rate) * 1000
    const trimFrames = Math.max(0, Math.floor((this.silenceRun - 200) / ms))
    const frames = this.segment.slice(0, this.segment.length - trimFrames)
    const total = frames.reduce((n, f) => n + f.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const f of frames) {
      out.set(f, offset)
      offset += f.length
    }
    const wasPtt = this.mode === "ptt"
    this.resetSegment()
    if (wasPtt) this.mode = "off"
    this.events.onUtterance(out, this.rate)
  }
}
