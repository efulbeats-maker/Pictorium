import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"

const UUID_A = "11111111-1111-4111-8111-111111111111"

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_MAX_MAPPINGS_PER_USER",
  "PICTORIUM_USER_RETENTION_DAYS",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TMDB_KEY",
  "ADMIN_TOKEN",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-slice3-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  process.env.ADMIN_TOKEN = "admin-secret"
  delete process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
  delete process.env.PICTORIUM_USER_RETENTION_DAYS
  delete process.env.PICTORIUM_TMDB_KEY
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function makeMapping(id: number, title: string): Mapping {
  return {
    tmdbId: id,
    mediaType: "movie",
    title,
    posterPath: `/p${id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    updatedAt: new Date().toISOString(),
  }
}

function nextReq(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(url, init)
}

async function createUser(): Promise<{ uuid: string; secret: string }> {
  vi.resetModules()
  const auth = await import("@/lib/user-auth")
  return auth.createUser()
}

describe("import/export namespaced", () => {
  it("import nel namespace (token), mai nel globale; export isolato; quota 413", async () => {
    const { uuid, secret } = await createUser()
    vi.resetModules()
    const importRoute = await import("@/app/api/mappings/import/route")
    const exportRoute = await import("@/app/api/mappings/export/route")
    const store = await import("@/lib/store")
    const headers = { "Content-Type": "application/json", "x-user-token": secret }
    const url = `http://localhost:3000/api/mappings/import?u=${uuid}`

    const res = await importRoute.POST(
      nextReq(url, { method: "POST", headers, body: JSON.stringify({ mappings: [makeMapping(1, "Uno"), makeMapping(2, "Due")] }) }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(2)
    expect(await store.getAll(uuid)).toHaveLength(2)
    expect(await store.getAll()).toHaveLength(0)

    const exp = await exportRoute.GET(nextReq(`http://localhost:3000/api/mappings/export?u=${uuid}`, { headers }))
    expect(exp.status).toBe(200)
    expect((await exp.json()).mappings).toHaveLength(2)

    // Senza token → 401, niente scrittura.
    const anon = await importRoute.POST(
      nextReq(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings: [makeMapping(9, "X")] }) }),
    )
    expect(anon.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(2)

    // Quota per-utente sull'import.
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "2"
    const over = await importRoute.POST(
      nextReq(url, { method: "POST", headers, body: JSON.stringify({ mappings: [makeMapping(3, "Tre")] }) }),
    )
    expect(over.status).toBe(413)
  })

  it("import-global: solo admin, copia globale→namespace con quota", async () => {
    vi.resetModules()
    const store = await import("@/lib/store")
    await store.upsert(makeMapping(1, "Globale"))
    const route = await import("@/app/api/users/[uuid]/import-global/route")
    const { uuid } = await createUser()

    const anon = await route.POST(nextReq(`http://x/api/users/${uuid}/import-global`, { method: "POST" }), {
      params: Promise.resolve({ uuid }),
    })
    expect(anon.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(0)

    const ok = await route.POST(
      nextReq(`http://x/api/users/${uuid}/import-global`, { method: "POST", headers: { "x-admin-token": "admin-secret" } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).count).toBe(1)
    expect((await store.getById("movie", 1, uuid))?.title).toBe("Globale")
    // Il globale resta intatto.
    expect(await store.getAll()).toHaveLength(1)
  })
})

describe("wipe account (GDPR)", () => {
  it("DELETE cancella il namespace e invalida il token; token errato → 401", async () => {
    const { uuid, secret } = await createUser()
    vi.resetModules()
    const store = await import("@/lib/store")
    const keys = await import("@/lib/user-keys")
    const defaults = await import("@/lib/server-defaults")
    const route = await import("@/app/api/users/[uuid]/route")
    await store.upsert(makeMapping(1, "Mio"), uuid)
    await keys.setUserKeys(uuid, { tmdb: "k" })
    await defaults.setServerDefaultsForUser(uuid, { badgeStyle: "pill" })

    const wrong = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": "nope" } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(wrong.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(1)

    const res = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": secret } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(res.status).toBe(200)
    expect(await store.getAll(uuid)).toHaveLength(0)
    expect(await keys.getUserKeysStatus(uuid)).toEqual({ tmdb: false, mdblist: false, tvdb: false })
    // Auth cancellata: il token non verifica più (secondo DELETE → 401).
    const auth = await import("@/lib/user-auth")
    expect(await auth.verifyUserToken(uuid, secret)).toBe(false)
    const again = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": secret } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(again.status).toBe(401)
  })
})

describe("cleanup inattivi", () => {
  it("retention 0 = disabilitato", async () => {
    process.env.PICTORIUM_USER_RETENTION_DAYS = "0"
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    expect(activity.getUserRetentionDays()).toBe(0)
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 0, disabled: true })
  })

  it("rimuove solo gli inattivi oltre soglia, mai senza lastAccess", async () => {
    process.env.PICTORIUM_USER_RETENTION_DAYS = "30"
    const { uuid: oldUuid } = await createUser()
    const { uuid: freshUuid } = await createUser()
    const { uuid: nodataUuid } = await createUser()
    vi.resetModules()
    const store = await import("@/lib/store")
    const activity = await import("@/lib/user-activity")
    await store.upsert(makeMapping(1, "Vecchio"), oldUuid)
    await store.upsert(makeMapping(2, "Fresco"), freshUuid)
    // Vecchio: attività 60gg fa. Fresco: tocco ora.
    await fsp.writeFile(
      path.join(tempDir!, "users", oldUuid, "activity.json"),
      JSON.stringify({ lastAccess: new Date(Date.now() - 60 * 86400000).toISOString() }),
    )
    activity.touchUserActivity(freshUuid)
    await new Promise((r) => setTimeout(r, 50))

    const result = await activity.cleanupInactiveUsers()
    expect(result.removed).toBe(1)
    expect(await store.getAll(oldUuid)).toHaveLength(0)
    expect(await store.getAll(freshUuid)).toHaveLength(1)
    // Senza lastAccess noto (solo auth fresca) → tenuto.
    expect(await store.getAll(nodataUuid)).toHaveLength(0)
    const kept = (await activity.listUsers()).map((u) => u.uuid)
    expect(kept).toContain(freshUuid)
    expect(kept).toContain(nodataUuid)
    expect(kept).not.toContain(oldUuid)
  })

  it("cleanup route: solo admin", async () => {
    vi.resetModules()
    const route = await import("@/app/api/users/cleanup/route")
    const anon = await route.POST(nextReq("http://x/api/users/cleanup", { method: "POST" }))
    expect(anon.status).toBe(401)
    const ok = await route.POST(
      nextReq("http://x/api/users/cleanup", { method: "POST", headers: { "x-admin-token": "admin-secret" } }),
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ disabled: false, retentionDays: 180 })
  })
})

describe("status aggregates", () => {
  it("GET /api/status: solo aggregati, mai UUID/segreti", async () => {
    await createUser()
    vi.resetModules()
    const route = await import("@/app/api/status/route")
    const res = await route.GET(nextReq("http://x/api/status"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.multiUser).toBe(true)
    expect(body.users).toBe(1)
    expect(typeof body.usersBytes).toBe("number")
    expect(body.keysEncryption).toBe(true)
    expect(body.keyMissing).toMatchObject({ catalogs: expect.any(Number), keyMissing: expect.any(Number) })
    expect(JSON.stringify(body)).not.toContain("11111111")
  })
})

describe("touch activity", () => {
  it("scrive lastAccess throttled senza rompere il chiamante", async () => {
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    activity.touchUserActivity(UUID_A)
    await new Promise((r) => setTimeout(r, 50))
    const raw = await fsp.readFile(path.join(tempDir!, "users", UUID_A, "activity.json"), "utf-8")
    const parsed = JSON.parse(raw) as { lastAccess: string }
    expect(Date.parse(parsed.lastAccess)).toBeGreaterThan(Date.now() - 60_000)
    // Secondo tocco immediato: nessun throw, nessun loop.
    activity.touchUserActivity(UUID_A)
  })
})
