// Small helpers shared by the AIRa route handlers.

export class UpstreamError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message)
  }
}

export function jsonError(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status })
}

export function errorResponse(err: unknown, scope: string): Response {
  if (err instanceof UpstreamError) {
    console.warn(`[aira:${scope}] ${err.code}: ${err.message}`)
    return jsonError(err.code, err.message, err.status)
  }
  if (err instanceof Error && err.name === "AbortError") {
    return jsonError("cancelled", "Request was cancelled.", 499)
  }
  // Log only the message: upstream errors may echo request details.
  console.error(
    `[aira:${scope}] unexpected error:`,
    err instanceof Error ? err.message : String(err),
  )
  return jsonError("internal", "Unexpected server error.", 500)
}

/** fetch with a timeout that also follows the incoming request's abort signal. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  provider = "upstream",
): Promise<Response> {
  const { timeoutMs = 10_000, signal, ...rest } = init
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  const cleanup = () => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
  if (signal?.aborted) controller.abort()
  signal?.addEventListener("abort", onAbort)
  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
    })
    if (!response.ok || !response.body) {
      cleanup()
      return response
    }

    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            cleanup()
            stream.close()
          } else {
            stream.enqueue(value)
          }
        } catch {
          cleanup()
          if (timedOut) {
            stream.error(
              new UpstreamError(
                "timeout",
                `${provider} did not respond in time.`,
                504,
              ),
            )
          } else if (signal?.aborted) {
            stream.error(
              Object.assign(new Error("cancelled"), { name: "AbortError" }),
            )
          } else {
            stream.error(new UpstreamError("network", `Could not read ${provider} response.`))
          }
        }
      },
      async cancel(reason) {
        cleanup()
        await reader.cancel(reason)
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch {
    cleanup()
    if (signal?.aborted)
      throw Object.assign(new Error("cancelled"), { name: "AbortError" })
    if (timedOut || controller.signal.aborted) {
      throw new UpstreamError(
        "timeout",
        `${provider} did not respond in time.`,
        504,
      )
    }
    throw new UpstreamError("network", `Could not reach ${provider}.`, 502)
  }
}

/** Maps an upstream HTTP status to a readable error without leaking response bodies. */
export function upstreamStatusError(
  provider: string,
  status: number,
): UpstreamError {
  if (status === 401 || status === 403) {
    return new UpstreamError(
      "unauthorized",
      `${provider} rejected the API key (HTTP ${status}).`,
      502,
    )
  }
  if (status === 429) {
    return new UpstreamError(
      "rate_limited",
      `${provider} rate limit or quota reached. Try again later.`,
      429,
    )
  }
  if (status === 400 || status === 422) {
    return new UpstreamError(
      "bad_request",
      `${provider} rejected the request (HTTP ${status}).`,
      502,
    )
  }
  return new UpstreamError(
    "upstream",
    `${provider} returned HTTP ${status}.`,
    502,
  )
}

// In-memory fixed-window rate limiter. Per server instance and reset on restart,
// which is enough to stop accidental request loops.
const buckets = new Map<string, { count: number; reset: number }>()

export function rateLimit(
  request: Request,
  name: string,
  limit: number,
  windowMs = 60_000,
): Response | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  const key = `${name}:${ip}`
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
    }
    return null
  }
  bucket.count += 1
  if (bucket.count > limit) {
    return jsonError(
      "rate_limited",
      "Too many requests. Please slow down a little.",
      429,
    )
  }
  return null
}

/** Tiny TTL cache for quota-heavy searches. */
export class TtlCache<T> {
  private map = new Map<string, { value: T; expires: number }>()
  constructor(
    private ttlMs: number,
    private max = 200,
  ) {}
  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (hit.expires < Date.now()) {
      this.map.delete(key)
      return undefined
    }
    return hit.value
  }
  set(key: string, value: T) {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value
      if (first !== undefined) this.map.delete(first)
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs })
  }
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
}

export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

export async function readJson<T>(
  request: Request,
  maxBytes = 32_000,
): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
    throw new UpstreamError("too_large", "Request body is too large.", 413)

  const reader = request.body?.getReader()
  if (!reader)
    throw new UpstreamError("bad_json", "Request body must be JSON.", 400)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch (err) {
          console.warn(
            "[aira:http] could not cancel oversized request body:",
            err instanceof Error ? err.message : String(err),
          )
        }
        throw new UpstreamError(
          "too_large",
          "Request body is too large.",
          413,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new UpstreamError("bad_json", "Request body must be JSON.", 400)
  }
}
