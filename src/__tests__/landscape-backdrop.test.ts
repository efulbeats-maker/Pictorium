import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  LAND_W,
  LAND_H,
  landscapeBackdropUrl,
  pillarboxLandscapeBase,
} from "@/lib/image-utils"

async function solidPng(width: number, height: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: hex } }).png().toBuffer()
}

describe("landscapeBackdropUrl", () => {
  it("uses the w780 tier for TMDB paths", () => {
    expect(landscapeBackdropUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w780/abc.jpg")
  })

  it("passes through TMDB https URLs untouched", () => {
    const url = "https://image.tmdb.org/t/p/original/abc.jpg"
    expect(landscapeBackdropUrl(url)).toBe(url)
  })

  it("blocks non-TMDB hosts like imgSrc (SSRF allowlist)", () => {
    expect(() => landscapeBackdropUrl("https://evil.example/x.jpg")).toThrow()
  })
})

describe("pillarboxLandscapeBase", () => {
  it("builds a 768x432 canvas from a portrait poster", async () => {
    const portrait = await solidPng(500, 750, "#336699")
    const out = await pillarboxLandscapeBase(portrait)
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(LAND_W)
    expect(meta.height).toBe(LAND_H)
  })

  it("keeps the portrait visible in the center band", async () => {
    // Poster rosso 2:3 → la colonna centrale deve restare rossa, i bordi
    // laterali il fondo blurrato/scurito (non rosso puro).
    const portrait = await solidPng(300, 450, "#ff0000")
    const out = await pillarboxLandscapeBase(portrait)
    const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
    }
    const center = px(Math.round(info.width / 2), Math.round(info.height / 2))
    expect(center[0]).toBeGreaterThan(200)
    expect(center[1]).toBeLessThan(60)
    const edge = px(5, Math.round(info.height / 2))
    // Fondo scurito (brightness 0.55): rosso molto attenuato ai bordi.
    expect(edge[0]).toBeLessThan(center[0])
  })
})
