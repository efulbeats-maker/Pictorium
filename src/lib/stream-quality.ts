import { createLogger } from "./logger"
import { getJWTitleQualityResult } from "./justwatch"
import { getExternalIds } from "./tmdb"
import { envWithFallback } from "./env-compat"
import { timedFetch } from "./outbound-stats"

const log = createLogger("stream-quality")

// Tier/soglia in quality-tiers.ts (zero dipendenze): qui solo re-export per
// compatibilità degli import esistenti (+ import type per l'uso locale).
import type { StreamQuality } from "./quality-tiers"
export type { StreamQuality } from "./quality-tiers"
export { parseMinQuality, isQualityAtLeast, applyMinQuality } from "./quality-tiers"

const TORRENTIO_BASE_URL = (envWithFallback("TORRENTIO_URL") || process.env.TORRENTIO_URL || "https://torrentio.strem.fun").replace(/\/+$/, "")
const STREAM_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const STREAM_CACHE_TTL_NULL = 2 * 60 * 1000 // 2 minutes for null (evita cache avvelenata su Vercel)

// Esito del rilevamento qualità: "resolved" = chiamata completata (anche con
// quality null = esito negativo accertato, es. film 1950 senza stream);
// "timeout" = abort per deadline; "error" = HTTP non-OK / rete. Solo
// resolved-null può cachare a lungo: timeout/error danno render degradato con
// TTL effimero (vedi route poster), altrimenti un outage di 10s avvelena la
// cache per 6h.
export type QualityStatus = "resolved" | "timeout" | "error"
export type QualitySource = "torrentio" | "justwatch" | "none"

export interface StreamQualityResult {
  readonly quality: StreamQuality | null
  readonly status: QualityStatus
  readonly source: QualitySource
  readonly rawTokens?: string[]
}

const qualityCache = new Map<string, { quality: StreamQualityResult; timestamp: number }>()

/** True se l'errore è uno scatto di deadline (AbortSignal.timeout / race). */
export function isQualityTimeout(err: unknown): boolean {
  // DOMException di abort/timeout (fetch): in Node NON è instanceof Error,
  // quindi il check sul nome viene prima e copre entrambi i nomi standard.
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return true
  if (typeof DOMException !== "undefined" && (err as DOMException)?.name === "AbortError") return true
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true
    if (/aborted|timeout|timed out/i.test(err.message)) return true
  }
  return false
}

/** Token grezzi (es. ["2160p","4k"]) dal testo degli stream — solo debug=1. */
export function extractRawQualityTokens(
  streams: Array<{ name?: string; title?: string; behaviorHints?: { filename?: string; bingeGroup?: string } }>,
): string[] {
  const found = new Set<string>()
  if (!Array.isArray(streams)) return []
  for (const s of streams) {
    const text = `${s.name || ""} ${s.title || ""} ${s.behaviorHints?.filename || ""} ${s.behaviorHints?.bingeGroup || ""}`
    for (const m of text.matchAll(/\b(4k|2160p?|uhd|1080p?|fhd|720p?|hd|480p?|576p?|sd|dvdrip|cam|ts)\b/gi)) {
      found.add(m[1].toLowerCase())
    }
  }
  return [...found]
}

export function parseStreamQualityFromStreams(
  streams: Array<{ name?: string; title?: string; behaviorHints?: { filename?: string; bingeGroup?: string } }>
): StreamQuality | null {
  if (!Array.isArray(streams) || streams.length === 0) return null

  let has1080p = false
  let has720p = false
  let hasSD = false

  for (const s of streams) {
    const text = `${s.name || ""} ${s.title || ""} ${s.behaviorHints?.filename || ""} ${s.behaviorHints?.bingeGroup || ""}`
    if (/\b(4k|2160[pi]?|uhd)\b/i.test(text)) {
      return "4K"
    }
    if (/\b(1080[pi]?|fhd)\b/i.test(text)) {
      has1080p = true
    } else if (/\b(720[pi]?|hd)\b/i.test(text)) {
      has720p = true
    } else if (/\b(480[pi]?|576[pi]?|sd|dvdrip|cam|ts)\b/i.test(text)) {
      hasSD = true
    }
  }

  if (has1080p) return "FHD"
  if (has720p) return "HD"
  if (hasSD) return "SD"
  return null
}

export async function fetchTorrentioQuality(
  type: "movie" | "series",
  imdbId: string,
  signal?: AbortSignal
): Promise<StreamQualityResult> {
  const streamId = type === "movie" ? imdbId : `${imdbId}:1:1`
  const url = `${TORRENTIO_BASE_URL}/stream/${type}/${encodeURIComponent(streamId)}.json`
  try {
    const timeoutSignal = AbortSignal.timeout(6000)
      let combinedSignal: AbortSignal = timeoutSignal
      if (signal) {
        if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
          combinedSignal = (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
        } else {
          // Fallback Node <19: combina manualmente i signal
          const ctrl = new AbortController()
          const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
          if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
          else {
            signal.addEventListener("abort", onAbort, { once: true })
            timeoutSignal.addEventListener("abort", onAbort, { once: true })
          }
          combinedSignal = ctrl.signal
        }
      }

      const res = await timedFetch(url, {
        headers: { "User-Agent": "Pictorium/1.0" },
        signal: combinedSignal,
      })
      if (!res.ok) {
        log.debug("Torrentio non-OK", { imdbId, status: res.status })
        return { quality: null, status: "error", source: "torrentio" }
      }
      const data = await res.json()
      const q = parseStreamQualityFromStreams(data?.streams)
      if (q) log.debug("Torrentio quality", { imdbId, quality: q })
      return { quality: q, status: "resolved", source: "torrentio", rawTokens: extractRawQualityTokens(data?.streams ?? []) }
    } catch (err) {
      log.debug("Torrentio stream quality check failed or timed out", { imdbId, error: err instanceof Error ? err.message : String(err) })
      return { quality: null, status: isQualityTimeout(err) ? "timeout" : "error", source: "torrentio" }
    }
}

export async function resolveStreamQuality(
  type: "movie" | "series",
  imdbId?: string | null,
  tmdbId?: number | null,
  searchTitle?: string | null,
  signal?: AbortSignal
): Promise<StreamQualityResult> {
  const cacheKey = `${type}:${imdbId || tmdbId || searchTitle}`
  const cached = qualityCache.get(cacheKey)
  if (cached) {
    // TTL differenziato per esito: resolved (anche null) 30min, timeout/error
    // 2min — un outage non deve restare appiccicato alla chiave.
    const ttl = cached.quality.status === "resolved" ? STREAM_CACHE_TTL : STREAM_CACHE_TTL_NULL
    if (Date.now() - cached.timestamp < ttl) return cached.quality
  }

  const store = (r: StreamQualityResult): StreamQualityResult => {
    qualityCache.set(cacheKey, { quality: r, timestamp: Date.now() })
    return r
  }

  // 1. Try Torrentio via IMDb ID
  let targetImdbId = imdbId
  if (!targetImdbId && tmdbId) {
    try {
      // A3: signal + tetto 8s (come POSTER_TMDB_TIMEOUT_MS) — prima senza
      // entrambi: un TMDB appeso teneva lo slot di render fino a 30s.
      const ext = await getExternalIds(type === "movie" ? "movie" : "tv", tmdbId, undefined, signal, 8000)
      if (ext.imdb_id) targetImdbId = ext.imdb_id
    } catch {}
  }

  let torrentioFailure: StreamQualityResult | null = null
  if (targetImdbId && targetImdbId.startsWith("tt")) {
    const t = await fetchTorrentioQuality(type, targetImdbId, signal)
    if (t.quality) return store(t)
    // 200 con streams vuoti = resolved-null (esito negativo accertato): il
    // fallback JW può ancora arricchire, ma se non trova nulla resta resolved.
    if (t.status !== "resolved") torrentioFailure = t
  }

  // 2. Fallback to JustWatch GraphQL if Torrentio returned nothing and tmdbId is present
  if (tmdbId) {
    try {
      const jw = await getJWTitleQualityResult(
        tmdbId,
        type === "movie" ? "MOVIE" : "SHOW",
        searchTitle,
        "IT",
        signal
      )
      if (jw.quality) return store({ quality: jw.quality, status: "resolved", source: "justwatch" })
      // ok=false (breaker aperto o trasporto fallito) = incertezza, NON miss:
      // resta l'eventuale failure di Torrentio, altrimenti error effimero.
      // Solo ok=true con quality null è esito negativo accertato.
      if (!jw.ok) {
        return store(torrentioFailure ?? {
          quality: null,
          status: signal?.aborted ? "timeout" : "error",
          source: "justwatch",
        })
      }
      return store(torrentioFailure ?? { quality: null, status: "resolved", source: targetImdbId ? "torrentio" : "justwatch" })
    } catch (err) {
      return store(torrentioFailure ?? { quality: null, status: isQualityTimeout(err) ? "timeout" : "error", source: "justwatch" })
    }
  }

  return store(torrentioFailure ?? { quality: null, status: "resolved", source: "none" })
}

export function __resetStreamQualityCache() {
  qualityCache.clear()
}
