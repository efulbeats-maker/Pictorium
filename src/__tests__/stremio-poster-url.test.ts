import { describe, expect, it } from "vitest"
import { buildStremioPosterUrl, mappingVersionParam } from "@/lib/stremio-poster-url"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { Mapping } from "@/lib/types"

function mapping(updatedAt: string): Mapping {
  return {
    tmdbId: 42,
    mediaType: "movie",
    title: "Test",
    posterPath: "/poster.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt,
  }
}

describe("buildStremioPosterUrl", () => {
  it("adds a mapping version parameter when a saved mapping exists", () => {
    const updatedAt = "2026-07-16T10:15:30.000Z"
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: { badgeStyle: "bar" },
      mapping: mapping(updatedAt),
    })

    expect(url.pathname).toBe("/api/poster/movie/42")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.get("mv")).toBe(String(Date.parse(updatedAt)))
    expect(url.searchParams.get("bs")).toBe("bar")
    // Mai segreti nei poster serviti (M2): niente api_key/mdblist_key.
    expect(url.searchParams.has("api_key")).toBe(false)
    expect(url.searchParams.has("mdblist_key")).toBe(false)
  })

  it("emits the mapping title for JustWatch matching", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: {},
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    })

    expect(url.searchParams.get("title")).toBe("Test")
  })

  it("omits title without a saved mapping", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.searchParams.has("title")).toBe(false)
  })

  it("omits mapping version for unsaved titles", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.pathname).toBe("/api/poster/series/94997")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.has("mv")).toBe(false)
  })

  it("forwards badge subcomponents and ribbonSide from mapping and defaults", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 123,
      defaults: {
        badgeGenre: true,
        badgeYear: false,
        badgeRating: true,
        badgeQuality: false,
        ratingSources: ["tmdb", "imdb"],
        ribbonSide: "right",
      },
      mapping: {
        ...mapping("2026-07-16T10:15:30.000Z"),
        badgeGenre: false,
        ribbonSide: "left",
      },
    })

    expect(url.searchParams.get("bg")).toBe("0") // mapping wins
    expect(url.searchParams.get("by")).toBe("0") // defaults
    expect(url.searchParams.has("br")).toBe(false) // badgeRating is true
    expect(url.searchParams.get("bq")).toBe("0") // defaults
    expect(url.searchParams.get("rsrc")).toBe("tmdb,imdb")
    expect(url.searchParams.get("side")).toBe("right") // solo globale: mapping ignorato
  })

  it("ignores invalid mapping timestamps", () => {
    expect(mappingVersionParam(mapping("not-a-date"))).toBeNull()
  })

  it("forceShape renders a landscape URL regardless of mapping/defaults", () => {
    // Banner Nuvio: stesso rendering in canvas landscape anche per titoli
    // portrait, con profilo landscape del mapping quando presente.
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), posterShape: "poster" as const },
    }
    const plain = buildStremioPosterUrl(base)
    expect(plain.searchParams.has("shape")).toBe(false)

    const forced = buildStremioPosterUrl({ ...base, forceShape: "landscape" })
    expect(forced.searchParams.get("shape")).toBe("landscape")
    expect(forced.searchParams.get("mv")).toBe(plain.searchParams.get("mv"))
    expect(forced.searchParams.get("title")).toBe("Test")
  })

  it("forceShape applies the mapping landscape tuning profile", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: { gradientHeight: 30 },
      mapping: {
        ...mapping("2026-07-16T10:15:30.000Z"),
        posterShape: "poster",
        gradientHeight: 50,
        landscape: { gradientHeight: 15 },
      },
    })
    // Senza force il titolo portrait usa il profilo flat...
    expect(url.searchParams.get("gradHeight")).toBe("50")

    const forced = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: { gradientHeight: 30 },
      mapping: {
        ...mapping("2026-07-16T10:15:30.000Z"),
        posterShape: "poster",
        gradientHeight: 50,
        landscape: { gradientHeight: 15 },
      },
      forceShape: "landscape",
    })
    // ...con force il banner usa il profilo landscape.
    expect(forced.searchParams.get("gradHeight")).toBe("15")
    expect(forced.searchParams.get("shape")).toBe("landscape")
  })

  it("emits hideLogo only for the Nuvio banner (never for poster)", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    }
    const poster = buildStremioPosterUrl(base)
    expect(poster.searchParams.has("hideLogo")).toBe(false)

    const banner = buildStremioPosterUrl({ ...base, forceShape: "landscape", hideLogo: true })
    expect(banner.searchParams.get("hideLogo")).toBe("1")
    expect(banner.searchParams.get("shape")).toBe("landscape")
  })

  it("passes per-title tintStrength to the banner, defaults to 20", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), tintStrength: 55 },
    }
    expect(buildStremioPosterUrl(base).searchParams.get("tint")).toBe("55")
    expect(buildStremioPosterUrl({ ...base, mapping: null }).searchParams.get("tint")).toBe("20")
  })

  it("defaults blurFade to 70 in landscape, 60 in portrait", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: null,
    }
    expect(buildStremioPosterUrl(base).searchParams.get("bf")).toBe("50")
    expect(buildStremioPosterUrl({ ...base, forceShape: "landscape" }).searchParams.get("bf")).toBe("70")
    // Mapping esplicito vince sul default di formato.
    expect(buildStremioPosterUrl({
      ...base,
      forceShape: "landscape",
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), blurFade: 40 },
    }).searchParams.get("bf")).toBe("40")
  })
})
