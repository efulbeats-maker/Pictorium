import { describe, expect, it } from "vitest"
import { getEffectiveRotationState, getEffectiveBackdropRotationState } from "@/lib/poster-rotation"
import type { Mapping } from "@/lib/types"

function mapping(input: Partial<Mapping>): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "Rotation Test",
    posterPath: "/a.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...input,
  }
}

describe("getEffectiveRotationState", () => {
  it("disables rotation when exclusions leave fewer than two posters", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg"],
      excludedPosters: ["/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availablePosters).toEqual(["/a.jpg"])
  })

  it("keeps rotation enabled when at least two posters remain", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg", "/c.jpg"],
      excludedPosters: ["/c.jpg"],
    }))

    expect(state.isRotating).toBe(true)
    expect(state.availablePosters).toEqual(["/a.jpg", "/b.jpg"])
  })
})

describe("getEffectiveBackdropRotationState", () => {
  it("disables rotation without flag or with fewer than two backdrops", () => {
    expect(getEffectiveBackdropRotationState(mapping({})).isRotating).toBe(false)
    expect(getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg"],
    })).isRotating).toBe(false)
  })

  it("disables rotation when exclusions leave fewer than two backdrops", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg", "/b.jpg"],
      excludedBackdrops: ["/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availableBackdrops).toEqual(["/a.jpg"])
  })

  it("keeps rotation enabled when at least two backdrops remain", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg", "/b.jpg", "/c.jpg"],
      excludedBackdrops: ["/c.jpg"],
    }))

    expect(state.isRotating).toBe(true)
    expect(state.availableBackdrops).toEqual(["/a.jpg", "/b.jpg"])
  })

  it("is independent from poster rotation", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availableBackdrops).toEqual([])
  })
})
