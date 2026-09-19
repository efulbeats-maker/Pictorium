import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import {
  parseStreamQualityFromStreams,
  resolveStreamQuality,
  __resetStreamQualityCache,
} from "@/lib/stream-quality"

describe("parseStreamQualityFromStreams", () => {
  it("returns null for empty array or invalid inputs", () => {
    expect(parseStreamQualityFromStreams([])).toBeNull()
  })

  it("identifies 4K / 2160p streams", () => {
    const streams = [
      { name: "Torrentio\n1080p", title: "Movie.1080p.BluRay" },
      { name: "Torrentio\n4k", title: "Movie.2160p.UHD.Remux" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("4K")
  })

  it("identifies FHD streams when no 4K is present", () => {
    const streams = [
      { name: "Torrentio\n720p", title: "Movie.720p.HD" },
      { name: "Torrentio\n1080p", title: "Movie.1080p.BluRay.x264" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("FHD")
  })

  it("identifies HD streams", () => {
    const streams = [
      { name: "Torrentio\n720p", title: "Movie.720p.HDTV" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("HD")
  })

  it("identifies SD streams", () => {
    const streams = [
      { name: "Torrentio\nSD", title: "Movie.480p.DVDRip" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("SD")
  })
})

describe("resolveStreamQuality", () => {
  beforeEach(() => {
    __resetStreamQualityCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches streams from Torrentio and resolves 4K", async () => {
    const mockStreams = {
      streams: [
        {
          name: "Torrentio\n4k HDR",
          title: "Avatar.2009.2160p.UHD",
          behaviorHints: { filename: "Avatar.2160p.mkv" },
        },
      ],
    }

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockStreams), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const result = await resolveStreamQuality("movie", "tt0499549")
    expect(result.quality).toBe("4K")
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("torrentio")
    expect(result.rawTokens).toContain("4k")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Caching check
    const cached = await resolveStreamQuality("movie", "tt0499549")
    expect(cached.quality).toBe("4K")
    expect(cached.status).toBe("resolved")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns resolved-null on 200 with empty streams (genuine negative)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/stream/")) {
        return new Response(JSON.stringify({ streams: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    // Senza tmdbId: nessun fallback JustWatch, solo Torrentio.
    const result = await resolveStreamQuality("movie", "tt0111161")
    expect(result.quality).toBeNull()
    expect(result.status).toBe("resolved")
  })

  it("returns timeout status when the upstream aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("The operation was aborted", "AbortError")
    )
    const result = await resolveStreamQuality("movie", "tt0133093")
    expect(result.quality).toBeNull()
    expect(result.status).toBe("timeout")
  })

  it("returns error status on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/stream/")) return new Response("boom", { status: 500 })
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await resolveStreamQuality("movie", "tt0133093")
    expect(result.quality).toBeNull()
    expect(result.status).toBe("error")
  })

  it("keeps torrentio failure when JustWatch transport also fails (no fake resolved)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/stream/")) return new Response("boom", { status: 500 })
      if (u.includes("justwatch.com")) return new Response("boom", { status: 500 })
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await resolveStreamQuality("movie", "tt0133093", 550)
    expect(result.quality).toBeNull()
    // Non resolved: il composito userà TTL effimero invece di 6h.
    expect(result.status).not.toBe("resolved")
  })

  it("returns resolved-null on genuine JustWatch miss (empty edges)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("/stream/")) {
        return new Response(JSON.stringify({ streams: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (u.includes("justwatch.com")) {
        return new Response(JSON.stringify({ data: { popularTitles: { edges: [] } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await resolveStreamQuality("movie", "tt0133093", 550)
    expect(result.quality).toBeNull()
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("torrentio")
  })
})
