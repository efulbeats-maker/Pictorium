import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { UserUnlockModal } from "@/components/UserUnlockModal"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import {
  __resetUnlockedUsersForTests,
  __resetUserCredentialsForTests,
  fetchWithUserAuthRetry,
  getStoredUserToken,
  isUserUnlocked,
  requestUserUnlock,
  setStoredUserPassword,
  setStoredUserToken,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

type TFn = (key: string, params?: Record<string, string | number>) => string

const realFetch = global.fetch

function setUrl(url: string): void {
  window.history.replaceState({}, "", url)
}

// jsdom di questo repo gira senza origin → localStorage nativo assente:
// mock in-memory come in user-space.test.ts.
function installStorages(): void {
  const mem = (store: Record<string, string>) => ({
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v) },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  })
  Object.defineProperty(window, "localStorage", { value: mem({}), configurable: true })
}

/** Host con `t` sostituibile a comando (simula il cambio lingua). */
function Host({ initialT }: { initialT: TFn }) {
  const [t, setT] = useState<TFn>(() => initialT)
  return (
    <PosterEditorProvider>
      <PictoriumProvider value={{ ...MOCK_CTX, t }}>
        <button data-testid="swap-t" onClick={() => setT(() => ((key: string) => `b:${key}`) as TFn)}>
          swap
        </button>
        <UserUnlockModal />
      </PictoriumProvider>
    </PosterEditorProvider>
  )
}

const tA = ((key: string) => `a:${key}`) as TFn

function renderModal() {
  return render(<Host initialT={tA} />)
}

function mockKeys(status: number) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (status === 200 ? { tmdb: true, hasPassword: true } : {}),
  })) as unknown as typeof fetch
}

beforeEach(() => {
  installStorages()
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl(`/u/${UUID}/configure`)
})

afterEach(() => {
  global.fetch = realFetch
  try { window.localStorage.clear() } catch { /* jsdom senza origin */ }
  __resetUnlockedUsersForTests()
  __resetUserCredentialsForTests()
  setUrl("/")
  vi.restoreAllMocks()
})

describe("UserUnlockModal dismiss e rientro", () => {
  it("si apre al mount su /u/<uuid>", () => {
    renderModal()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("il click sul backdrop NON chiude (solo la X esplicita)", () => {
    renderModal()
    const dialog = screen.getByRole("dialog")
    // Il backdrop è il parent diretto del dialog: prima chiudeva qui.
    fireEvent.click(dialog.parentElement!)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("la X chiude e mostra la pill Accedi; la pill riapre il modal", () => {
    renderModal()
    fireEvent.click(screen.getByLabelText("a:ui.close"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Pill persistente di rientro: mai un vicolo cieco.
    fireEvent.click(screen.getByRole("button", { name: "a:ui.userUnlockOpen" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("il cambio lingua (t nuova) non riapre il modal chiuso apposta", () => {
    renderModal()
    fireEvent.click(screen.getByLabelText("a:ui.close"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Nuova identità di `t`: l'effect rigira ma la guardia mount-once blocca.
    fireEvent.click(screen.getByTestId("swap-t"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // E la pill è ancora lì (testi ri-prefissati, prova del re-render).
    expect(screen.getByRole("button", { name: "b:ui.userUnlockOpen" })).toBeInTheDocument()
  })

  it("già sbloccato in sessione: non si auto-apre (niente doppio prompt dal gate)", () => {
    setStoredUserPassword(UUID, "pw-1")
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: UUID } }))
    renderModal()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("requestUserUnlock riapre anche dopo pill nascosta", () => {
    renderModal()
    fireEvent.click(screen.getByLabelText("a:ui.close"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    act(() => requestUserUnlock(UUID))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})

describe("UserUnlockModal login via secret", () => {
  async function loginSecret(value: string) {
    renderModal()
    // Passa al tab secret.
    fireEvent.click(screen.getByRole("button", { name: "a:ui.userUnlockUseSecret" }))
    const inputs = screen.getAllByPlaceholderText("••••••••")
    const secretInput = inputs[inputs.length - 1]
    fireEvent.change(secretInput, { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "a:ui.save" }))
  }

  it("secret invalido: il modal resta aperto, niente unlock", async () => {
    mockKeys(401)
    await loginSecret("wrong-secret")
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(isUserUnlocked(UUID)).toBe(false)
    expect(getStoredUserToken(UUID)).toBeNull()
  })

  it("secret valido: chiude, salva e sblocca", async () => {
    mockKeys(200)
    await loginSecret("good-secret")
    await waitFor(() => expect(isUserUnlocked(UUID)).toBe(true))
    expect(getStoredUserToken(UUID)).toBe("good-secret")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

describe("fetchWithUserAuthRetry", () => {
  it("senza credenziali: un solo fetch, niente retry", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await fetchWithUserAuthRetry(UUID, "/api/users/x/keys")
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("secret stantio + password fresca: retry con sola password e secret buttato", async () => {
    setStoredUserToken(UUID, "stale-secret")
    setStoredUserPassword(UUID, "fresh-password")
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const headers = { ...((init?.headers ?? {}) as Record<string, string>) }
      calls.push({ url: String(url), headers })
      if (headers["x-user-token"] === "stale-secret") return { ok: false, status: 401 } as Response
      if (headers["x-user-password"] === "fresh-password" && !headers["x-user-token"]) {
        return { ok: true, status: 200, json: async () => ({ tmdb: true }) } as Response
      }
      return { ok: false, status: 500 } as Response
    }) as unknown as typeof fetch
    const res = await fetchWithUserAuthRetry(UUID, "/api/users/x/keys")
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
    // Il retry non porta il token stantio.
    expect(calls[1].headers["x-user-token"]).toBeUndefined()
    // Secret provatamente invalido: rimosso dallo storage.
    expect(getStoredUserToken(UUID)).toBeNull()
  })

  it("secret stantio + password errata: 401, secret conservato", async () => {
    setStoredUserToken(UUID, "stale-secret")
    setStoredUserPassword(UUID, "wrong-password")
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await fetchWithUserAuthRetry(UUID, "/api/users/x/keys")
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getStoredUserToken(UUID)).toBe("stale-secret")
  })
})
