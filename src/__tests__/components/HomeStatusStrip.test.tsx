import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { HomeStatusStrip } from "@/components/HomeStatusStrip"
import { renderWithCtx } from "@/__tests__/test-utils"

function mockStatus(payload: unknown, opts?: { ok?: boolean; reject?: boolean }) {
  global.fetch = (async () => {
    if (opts?.reject) throw new Error("network down")
    return { ok: opts?.ok ?? true, status: 200, json: async () => payload }
  }) as unknown as typeof fetch
}

const realFetch = global.fetch

beforeEach(() => {
  window.history.replaceState({}, "", "/")
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe("HomeStatusStrip spaces indicator", () => {
  it("mostra occupazione spazi quando multi-user è attivo con cap", async () => {
    mockStatus({ multiUser: true, users: 3, maxUsers: 100 })
    renderWithCtx(<HomeStatusStrip />)
    await waitFor(() => expect(screen.getByTestId("home-spaces")).toHaveTextContent("3/100 spazi"))
  })

  it("mostra solo il conteggio quando il cap è illimitato (maxUsers 0)", async () => {
    mockStatus({ multiUser: true, users: 7, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)
    await waitFor(() => expect(screen.getByTestId("home-spaces")).toHaveTextContent("7 spazi"))
  })

  it("resta nascosto quando multi-user è spento", async () => {
    mockStatus({ multiUser: false, users: 0, maxUsers: 0 })
    renderWithCtx(<HomeStatusStrip />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("home-spaces")).toBeNull()
  })

  it("resta nascosto se l'endpoint fallisce", async () => {
    mockStatus(null, { reject: true })
    renderWithCtx(<HomeStatusStrip />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId("home-spaces")).toBeNull()
  })
})
