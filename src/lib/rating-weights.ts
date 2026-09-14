/**
 * Voto medio a media pari (unico comportamento: i preset pesati sono stati
 * rimossi, resta il legacy).
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

/** Media pari sulle fonti richieste (default imdb/tmdb). */
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
 * Voto unico a media pari sulle fonti richieste (`rsrc` o default imdb/tmdb).
 */
export function computeVote(
  ratings: AggregatedRatings | null,
  rsrc?: readonly string[] | null,
): number | null {
  const allowlist = rsrc && rsrc.length > 0 ? rsrc.map((s) => s.toLowerCase()) : null
  return equalAverage(ratings, allowlist ?? [...DEFAULT_RATING_SOURCES])
}
