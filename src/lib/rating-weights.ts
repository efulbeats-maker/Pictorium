/**
 * Preset pesati per il voto medio (Fase 3).
 *
 * Modulo quasi-puro: importa solo costanti da `ratings.ts` (mai mockate via
 * factory — i test di route usano importOriginal). `computeVote` è l'unico
 * choke point usato da poster route, details route e client (stesso numero
 * ovunque = Golden Rule).
 *
 * NOTA sui voti-per-fonte: il payload MDBList NON riporta conteggi voti per
 * fonte (verificato live: ogni rating ha solo source/value/score) — quindi
 * niente filtro RATING_MIN_VOTES. Una fonte senza score contribuisce zero
 * (renormalizzazione), mai trascinamento verso il basso.
 */

import type { AggregatedRatings } from "./ratings"
import { DEFAULT_RATING_SOURCES } from "./ratings"

export const RATING_PRESETS = ["balanced", "cinephile", "series", "raw"] as const

export type RatingPreset = (typeof RATING_PRESETS)[number]

export const DEFAULT_RATING_PRESET: RatingPreset = "balanced"

export interface RatingRecipe {
  readonly sources: readonly string[]
  readonly weights: Readonly<Record<string, number>>
}

const RECIPES: Record<"cinephile" | "series", RatingRecipe> = {
  // Film: Letterboxd discrimina più di IMDb sui non-blockbuster.
  cinephile: { sources: ["letterboxd", "tomatoes"], weights: { letterboxd: 0.8, tomatoes: 0.2 } },
  // Serie: Trakt domina, RT da contrappeso (Letterboxd sulle serie è irrilevante).
  series: { sources: ["trakt", "tomatoes"], weights: { trakt: 0.8, tomatoes: 0.2 } },
}

/** `raw` = alias legacy di `balanced`. Invalido → null (il chiamante applica la catena). */
export function parseRatingPreset(raw: string | null | undefined): RatingPreset | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === "balanced" || v === "cinephile" || v === "series" || v === "raw") return v
  return null
}

/** Media pesata con renormalizzazione sulle fonti presenti (assenti = contributo zero). */
export function calculateWeightedRating(
  ratings: AggregatedRatings | null,
  sources: readonly string[],
  weights: Readonly<Record<string, number>>,
): number | null {
  if (!ratings || !ratings.sources) return null
  let acc = 0
  let wsum = 0
  for (const rawSrc of sources) {
    const src = rawSrc.toLowerCase()
    const v = ratings.sources[src]
    const w = weights[src] ?? 0
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && w > 0) {
      acc += v * w
      wsum += w
    }
  }
  if (wsum <= 0) return null
  return acc / wsum
}

function equalAverage(ratings: AggregatedRatings | null, sources: readonly string[]): number | null {
  if (!ratings || !ratings.sources) return null
  const values: number[] = []
  for (const rawSrc of sources) {
    const v = ratings.sources[rawSrc.toLowerCase()]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) values.push(v)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Voto unico con preset pesati + fallback a catena (mai badge vuoto se il
 * legacy mostrerebbe un voto):
 * 1. preset cinephile/series → pesata sulle fonti recipe (filtrate da `rsrc`
 *    se presente); intersezione vuota o nessun valore → passo 2.
 * 2. media pari sulle fonti richieste (`rsrc` o default imdb/tmdb) = legacy.
 */
export function computeVote(
  ratings: AggregatedRatings | null,
  preset: RatingPreset,
  rsrc?: readonly string[] | null,
): number | null {
  const allowlist = rsrc && rsrc.length > 0 ? rsrc.map((s) => s.toLowerCase()) : null
  if (preset === "cinephile" || preset === "series") {
    const recipe = RECIPES[preset]
    const sources = allowlist ? recipe.sources.filter((s) => allowlist.includes(s)) : [...recipe.sources]
    if (sources.length > 0) {
      const weighted = calculateWeightedRating(ratings, sources, recipe.weights)
      if (weighted !== null) return weighted
    }
  }
  return equalAverage(ratings, allowlist ?? [...DEFAULT_RATING_SOURCES])
}
