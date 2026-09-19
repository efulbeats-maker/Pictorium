import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { UserKeysSection } from "@/components/UserKeysSection"
import { renderWithCtx } from "@/__tests__/test-utils"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  setStoredUserPassword,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

const UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

const realFetch = global.fetch

function unlock() {
  window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
}

beforeEach(() => {
  installStorages()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl(`/u/${UUID}/configure`)
  setStoredUserPassword(UUID, "my-valid-password")
  unlock()
})

afterEach(() => {
  global.fetch = realFetch
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl("/")
  vi.restoreAllMocks()
})

describe("UserKeysSection", () => {
  it("renderizza pallini solidi mascherati (non vuoti) per le chiavi salvate su server", async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`) && !u.includes("/reveal")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: true, tvdb: true, hasPassword: true }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    // Attendi il caricamento dello stato chiavi
    await waitFor(() => {
      expect(screen.getAllByText("ui.userKeysSet")).toHaveLength(3)
    })

    const passwordInputs = screen.getAllByDisplayValue(/••••/)
    expect(passwordInputs).toHaveLength(3)
    for (const input of passwordInputs) {
      expect(input).toHaveAttribute("type", "password")
      // Non deve essere vuoto
      expect((input as HTMLInputElement).value.length).toBeGreaterThanOrEqual(28)
    }
  })

  it("click su reveal svela la chiave reale e converte type a text", async () => {
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        const body = JSON.parse(String(init?.body || "{}"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ kind: body.kind, value: `real-secret-${body.kind}` }),
        }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    // Trova il pulsante mostra per TMDB
    const showBtns = screen.getAllByRole("button", { name: "ui.showKey" })
    fireEvent.click(showBtns[0])

    await waitFor(() => {
      expect(screen.getByDisplayValue("real-secret-tmdb")).toBeInTheDocument()
    })

    const revealedInput = screen.getByDisplayValue("real-secret-tmdb")
    expect(revealedInput).toHaveAttribute("type", "text")
  })

  it("modificando un campo mascherato rimuove i bullet e abilita il tasto Salva", async () => {
    global.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    const tmdbInput = screen.getByDisplayValue(/••••/)
    const saveBtn = screen.getByRole("button", { name: "ui.save" })
    expect(saveBtn).toBeDisabled()

    // L'utente digita una nuova chiave (o incolla)
    fireEvent.change(tmdbInput, { target: { value: "my-brand-new-key-12345" } })

    expect(screen.getByDisplayValue("my-brand-new-key-12345")).toBeInTheDocument()
    expect(saveBtn).not.toBeDisabled()
  })

  it("click su copia di una chiave mascherata svela la chiave reale e la copia negli appunti", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (u.includes(`/api/users/${UUID}/keys/reveal`)) {
        const body = JSON.parse(String(init?.body || "{}"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ kind: body.kind, value: `revealed-copied-${body.kind}` }),
        }
      }
      if (u.includes(`/api/users/${UUID}/keys`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tmdb: true, mdblist: false, tvdb: false }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderWithCtx(<UserKeysSection />)

    await waitFor(() => {
      expect(screen.getByText("ui.userKeysSet")).toBeInTheDocument()
    })

    const copyBtns = screen.getAllByRole("button", { name: /Copia UUID|ui\.copyUuid/i })
    fireEvent.click(copyBtns[0])

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("revealed-copied-tmdb")
    })
  })
})
