// Loads the YouTube IFrame Player API once.

export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  loadVideoById(id: string): void
  cueVideoById(id: string): void
  setVolume(volume: number): void
  getCurrentTime(): number
  getDuration(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getPlayerState(): number
  destroy(): void
}

export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string
      width?: string | number
      height?: string | number
      host?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: number; target: YTPlayer }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}

export const YT_STATE = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

let loading: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  const w = window as unknown as {
    YT?: YTNamespace & { loaded?: number }
    onYouTubeIframeAPIReady?: () => void
  }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (loading) return loading
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (w.YT) resolve(w.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    script.async = true
    script.onerror = () => {
      loading = null
      reject(new Error("Could not load the YouTube player."))
    }
    document.head.appendChild(script)
  })
  return loading
}
