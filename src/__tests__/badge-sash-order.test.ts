import { describe, expect, it } from "vitest"
import {
  parseSashOrder,
  normalizeSashOrder,
  isDefaultSashOrder,
  DEFAULT_SASH_ORDER,
  computeBadge,
  type BadgeParams,
} from "@/lib/badge-priority"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"

const t = (k: string) => k

function base(over: Partial<BadgeParams> = {}): BadgeParams {
  return {
    mediaType: "movie",
    upcomingRelease: null,
    isNewMovie: false,
    isNewSeries: false,
    newSeason: null,
    animeRank: null,
    trendRank: null,
    award: null,
    nomination: null,
    studio: null,
    director: null,
    subGenre: null,
    isKDrama: false,
    imdbTop250: false,
    extra: null,
    ...over,
  }
}

describe("parseSashOrder", () => {
  it("token validi in ordine, dedup, case-insensitive", () => {
    expect(parseSashOrder("rank,award,new")).toEqual(["rank", "award", "new"])
    expect(parseSashOrder(" Award ,RANK,award ")).toEqual(["award", "rank"])
  })

  it("assente → null (catena continua); vuota → [] (tutto spento esplicito)", () => {
    expect(parseSashOrder(null)).toBeNull()
    expect(parseSashOrder(undefined)).toBeNull()
    expect(parseSashOrder("")).toEqual([])
    expect(parseSashOrder("  ")).toEqual([])
  })

  it("solo garbage → null (mai spazzatura, fallback default)", () => {
    expect(parseSashOrder("tarocco,festival@0")).toBeNull()
  })
})

describe("normalizeSashOrder / isDefaultSashOrder", () => {
  it("filtra e canonicalizza in ordine default", () => {
    expect(normalizeSashOrder(["extra", "rank", "bogus", "rank"])).toEqual(["rank", "extra"])
    expect(normalizeSashOrder([])).toEqual([])
    expect(normalizeSashOrder(null)).toBeNull()
    expect(normalizeSashOrder("rank")).toBeNull()
  })

  it("default solo se identico in ordine e contenuto", () => {
    expect(isDefaultSashOrder([...DEFAULT_SASH_ORDER])).toBe(true)
    expect(isDefaultSashOrder(null)).toBe(true)
    expect(isDefaultSashOrder(undefined)).toBe(true)
    expect(isDefaultSashOrder(["rank"])).toBe(false)
    expect(isDefaultSashOrder([...DEFAULT_SASH_ORDER].reverse())).toBe(false)
    expect(isDefaultSashOrder([])).toBe(false)
  })
})

describe("computeBadge con ordine custom", () => {
  it("default invariato: rank batte award, new batte award", () => {
    expect(computeBadge(base({ trendRank: 3, award: "Oscar" }), t)?.type).toBe("rank")
    expect(computeBadge(base({ isNewMovie: true, award: "Oscar" }), t)?.label).toBe("badge.newMovie")
  })

  it("ordine custom: award batte rank", () => {
    const b = computeBadge(base({ trendRank: 3, award: "Oscar" }), t, ["award", "rank", "new", "upcoming", "extra"])
    expect(b)?.toMatchObject({ type: "extra", label: "Oscar" })
  })

  it("sottoinsieme: bucket non listati spenti", () => {
    expect(computeBadge(base({ trendRank: 3 }), t, ["award", "extra"])).toBeNull()
    expect(computeBadge(base({ trendRank: 3 }), t, ["rank"])).toMatchObject({ type: "rank", rank: 3 })
  })

  it("lista vuota: nessun badge mai", () => {
    expect(computeBadge(base({ trendRank: 3, award: "Oscar", isNewMovie: true }), t, [])).toBeNull()
  })

  it("ordine interno ai bucket preservato (anime prima di trend)", () => {
    const b = computeBadge(base({ animeRank: 5, trendRank: 3 }), t, ["rank"])
    expect(b)?.toMatchObject({ type: "rank", rank: 5 })
  })
})

describe("stremio params: sash emesso solo quando non-default", () => {
  it("default omesso, custom emesso, tutto-spento emesso vuoto", () => {
    expect(buildStremioPosterSearchParams({}).get("sash")).toBeNull()
    expect(buildStremioPosterSearchParams({ sashOrder: [...DEFAULT_SASH_ORDER] }).get("sash")).toBeNull()
    expect(buildStremioPosterSearchParams({ sashOrder: ["rank", "award"] }).get("sash")).toBe("rank,award")
    expect(buildStremioPosterSearchParams({ sashOrder: [] }).get("sash")).toBe("")
  })
})
