import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

// UserSpaceSection (renderizzato dal pannello) richiede l'app router di Next:
// in jsdom non è montato (stesso mock usato in EditViewGate.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

describe("SettingsPanel", () => {
  it("renders genre/rating badge toggle and mirror card", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Toggle nella card Badge + titolo della card specchio nel tab Trasforma.
    expect(screen.getAllByText("ui.genreRatingBadge")).toHaveLength(2)
  })

  it("renders trend badge toggle", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.trendBadge")).toBeInTheDocument()
  })

  it("renders clear cache button", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const buttons = screen.getAllByRole("button")
    const clearBtn = buttons.find((b) => b.textContent === "ui.clearCache")
    expect(clearBtn).toBeTruthy()
  })

  it("renders export and import buttons", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.exportJson")).toBeInTheDocument()
    expect(screen.getByText("ui.importJson")).toBeInTheDocument()
  })

  it("renders badge style selector", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.styleDefault")).toBeInTheDocument()
  })

  it("does not render API key inputs", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.queryByPlaceholderText("ui.tmdbKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.mdblistKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.tvdbKeyPlaceholder")).toBeNull()
  })

  it("renders 4 tabs and switches active tab on click", async () => {
    const { fireEvent } = await import("@testing-library/react")
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const badgeTab = screen.getByRole("tab", { name: "ui.badgeSection" })
    const transformTab = screen.getByRole("tab", { name: "ui.transform" })
    const prefsTab = screen.getByRole("tab", { name: "ui.settingsTabPrefs" })
    const dataTab = screen.getByRole("tab", { name: "ui.settingsTabData" })

    expect(badgeTab).toHaveAttribute("aria-selected", "true")
    expect(transformTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")
    expect(dataTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(prefsTab)
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "true")
    expect(dataTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByText("ui.settingsAutomationTitle")).toBeInTheDocument()

    fireEvent.click(dataTab)
    expect(dataTab).toHaveAttribute("aria-selected", "true")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(transformTab)
    expect(transformTab).toHaveAttribute("aria-selected", "true")
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
  })

  it("calls setSettingsOpen(false) when close button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const closeSpy = vi.fn()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={closeSpy}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const closeButtons = screen.getAllByRole("button", { name: /Chiudi|ui\.close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
    fireEvent.click(closeButtons[0])
    expect(closeSpy).toHaveBeenCalledWith(false)
  })

  it("mostra la sezione PIN con multi-user spento", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: false }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(await screen.findByText("ui.pinSecurityTitle")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("nasconde la sezione PIN con multi-user attivo (niente doppio lucchetto)", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: true }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Il pannello c'è (altro contenuto stabile), la sezione PIN sparisce.
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByText("ui.pinSecurityTitle")).not.toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("tab Spazio dedicato: fuori da Dati & Cache, solo con contenuto", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/status")
          ? { ok: true, json: async () => ({ multiUser: true }) }
          : { ok: false, json: async () => ({}) },
      ),
    )
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Quinto tab; il gate vive lì dentro (divider crea/entri).
    const tab = await screen.findByRole("tab", { name: "ui.settingsTabSpace" })
    expect(screen.getAllByRole("tab")).toHaveLength(5)
    fireEvent.click(tab)
    expect(tab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText("ui.userSpaceOr")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("senza multi-user né /u/ il tab Spazio non esiste (restano 4)", async () => {
    resetGuestGuardForTests()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(await screen.findAllByText("ui.genreRatingBadge")).not.toHaveLength(0)
    expect(screen.queryByRole("tab", { name: "ui.settingsTabSpace" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("tab")).toHaveLength(4)
    resetGuestGuardForTests()
  })

  it("allows selecting TVDB as episode metadata source in prefs tab", async () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const prefsTab = screen.getByRole("tab", { name: "ui.settingsTabPrefs" })
    fireEvent.click(prefsTab)

    const tvdbBtn = screen.getByRole("button", { name: "TVDB" })
    const tmdbBtn = screen.getByRole("button", { name: "TMDB" })

    // TMDB default: highlighted with bg-white/20
    expect(tmdbBtn.className).toContain("bg-white/20")
    expect(tvdbBtn.className).not.toContain("bg-white/20")

    // Click TVDB
    fireEvent.click(tvdbBtn)
    expect(tvdbBtn.className).toContain("bg-white/20")
    expect(tmdbBtn.className).not.toContain("bg-white/20")

    // Click TMDB back
    fireEvent.click(tmdbBtn)
    expect(tmdbBtn.className).toContain("bg-white/20")
    expect(tvdbBtn.className).not.toContain("bg-white/20")
  })
})
