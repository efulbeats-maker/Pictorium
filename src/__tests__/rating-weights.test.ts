import { describe, expect, it } from "vitest"
import {
  parseRatingPreset,
  calculateWeightedRating,
  computeVote,
} from "@/lib/rating-weights"
import { calculateAverageRating } from "@/lib/ratings"
import type { AggregatedRatings } from "@/lib/ratings"

const sample: AggregatedRatings = {
  sources: { imdb: 8.0, tmdb: 7.0, letterboxd: 8.0, tomatoes: 6.0, trakt: 9.0 },
  average: 0,
  count: 5,
}

describe("parseRatingPreset", () => {
  it("valida i 4 preset (case-insensitive), raw incluso", () => {
    expect(parseRatingPreset("balanced")).toBe("balanced")
    expect(parseRatingPreset("CINEPHILE")).toBe("cinephile")
    expect(parseRatingPreset(" series ")).toBe("series")
    expect(parseRatingPreset("raw")).toBe("raw")
  })

  it("invalido/assente → null (il chiamante applica la catena)", () => {
    expect(parseRatingPreset("tarocco")).toBeNull()
    expect(parseRatingPreset("")).toBeNull()
    expect(parseRatingPreset(null)).toBeNull()
    expect(parseRatingPreset(undefined)).toBeNull()
  })
})

describe("calculateWeightedRating", () => {
  it("media pesata base", () => {
    // 8.0*0.8 + 6.0*0.2 = 7.6
    expect(calculateWeightedRating(sample, ["letterboxd", "tomatoes"], { letterboxd: 0.8, tomatoes: 0.2 })).toBeCloseTo(7.6, 5)
  })

  it("renormalizza sulle fonti presenti (assenti = contributo zero)", () => {
    // solo letterboxd presente → peso riscalato a 1 → 8.0
    expect(calculateWeightedRating(sample, ["letterboxd", "metacritic"], { letterboxd: 0.8, metacritic: 0.2 })).toBe(8.0)
  })

  it("null quando nessuna fonte ha valori", () => {
    expect(calculateWeightedRating(sample, ["metacritic"], { metacritic: 1 })).toBeNull()
    expect(calculateWeightedRating(null, ["imdb"], { imdb: 1 })).toBeNull()
  })
})

describe("computeVote", () => {
  it("balanced ≡ legacy (nessun cambio pixel di default)", () => {
    expect(computeVote(sample, "balanced")).toBe(calculateAverageRating(sample))
    expect(computeVote(sample, "raw")).toBe(calculateAverageRating(sample))
    expect(computeVote(sample, "balanced", ["imdb", "tomatoes"])).toBe(
      calculateAverageRating(sample, ["imdb", "tomatoes"]),
    )
  })

  it("cinephile pesa Letterboxd 0.8 / RT 0.2", () => {
    // 8.0*0.8 + 6.0*0.2 = 7.6 (vs legacy 7.5)
    expect(computeVote(sample, "cinephile")).toBeCloseTo(7.6, 5)
  })

  it("series pesa Trakt 0.8 / RT 0.2", () => {
    // 9.0*0.8 + 6.0*0.2 = 8.4
    expect(computeVote(sample, "series")).toBeCloseTo(8.4, 5)
  })

  it("fallback silenzioso su legacy quando le fonti preset mancano del tutto", () => {
    const noLb = { sources: { imdb: 8.0, tmdb: 7.0 }, average: 0, count: 2 }
    expect(computeVote(noLb, "cinephile")).toBe(7.5)
    expect(computeVote(noLb, "series")).toBe(7.5)
  })

  it("rsrc filtra le fonti preset; intersezione vuota → legacy su rsrc", () => {
    // solo tomatoes di rsrc ∩ preset → 6.0 (peso riscalato)
    expect(computeVote(sample, "cinephile", ["imdb", "tomatoes"])).toBeCloseTo(6.0, 5)
    // nessuna intersezione → media pari su rsrc
    expect(computeVote(sample, "cinephile", ["imdb"])).toBe(8.0)
  })

  it("null quando non c'è proprio niente", () => {
    expect(computeVote(null, "cinephile")).toBeNull()
    expect(computeVote({ sources: {}, average: 0, count: 0 }, "balanced")).toBeNull()
  })
})
