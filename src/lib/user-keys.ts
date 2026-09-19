import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { createLogger } from "@/lib/logger"
import { userDir } from "@/lib/user-auth"

const log = createLogger("user-keys")

const useKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN

export type UserKeyKind = "tmdb" | "mdblist" | "tvdb"
export const USER_KEY_KINDS: readonly UserKeyKind[] = ["tmdb", "mdblist", "tvdb"]

export type UserKeys = Partial<Record<UserKeyKind, string>>

/** Salvataggio rifiutato: cifratura non disponibile → fail-closed, mai in chiaro. */
export class KeysEncryptionUnavailableError extends Error {
  constructor() {
    super("Profile key encryption is unavailable: set PROFILE_ENCRYPTION_KEY (openssl rand -hex 32)")
    this.name = "KeysEncryptionUnavailableError"
  }
}

/** Valore chiave non valido (vuoto oltre il consentito / troppo lungo). */
export class InvalidUserKeyError extends Error {
  constructor(kind: string) {
    super(`Invalid API key for ${kind}`)
    this.name = "InvalidUserKeyError"
  }
}

function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

/**
 * Chiave AES-256-GCM da PROFILE_ENCRYPTION_KEY (`openssl rand -hex 32`).
 * Stretta di proposito: solo 64 hex chars (= 32 byte). Qualsiasi altro
 * formato → null (fail-closed, mai cifratura debole/silente).
 */
function encryptionKey(): Buffer | null {
  const raw = process.env.PROFILE_ENCRYPTION_KEY?.trim()
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) return null
  return Buffer.from(raw, "hex")
}

export function isUserKeysEncryptionAvailable(): boolean {
  return encryptionKey() !== null
}

interface EncBundle {
  iv: string
  tag: string
  data: string
}

interface KeysFile {
  version: 1
  keys: Partial<Record<UserKeyKind, EncBundle>>
  updatedAt: string
}

function encryptSecret(plaintext: string, key: Buffer): EncBundle {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  }
}

function decryptSecret(bundle: EncBundle, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"))
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(bundle.data, "base64")), decipher.final()]).toString("utf8")
}

function keysFile(userId: string): string {
  return path.join(userDir(userId), "keys.json")
}

function keysKvKey(userId: string): string {
  return `user:${userId}:keys`
}

function isValidBundle(v: unknown): v is EncBundle {
  if (!v || typeof v !== "object") return false
  const b = v as Record<string, unknown>
  return typeof b.iv === "string" && typeof b.tag === "string" && typeof b.data === "string"
}

async function readKeysFile(userId: string): Promise<KeysFile | null> {
  if (useKv) {
    try {
      const { kv } = await import("@vercel/kv")
      const raw = await kv.get<KeysFile>(keysKvKey(userId))
      if (raw && typeof raw === "object" && raw.version === 1 && raw.keys && typeof raw.keys === "object") {
        return raw
      }
      return null
    } catch (e) {
      log.warn("user keys KV read failed", { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }
  try {
    const raw = await fsp.readFile(keysFile(userId), "utf-8")
    const parsed = JSON.parse(raw) as Partial<KeysFile>
    if (parsed?.version === 1 && parsed.keys && typeof parsed.keys === "object") {
      return parsed as KeysFile
    }
    return null
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") return null
    log.warn("user keys read failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Chiavi decifrate del namespace (solo memoria, mai loggate).
 * Bundle non decifrabili (env ruotata/rimossa — v1 non supporta rotazione) →
 * skippati con error log e trattati come assenti (degraded, mai throw).
 */
export async function getUserKeys(userId: string): Promise<UserKeys> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  if (!file) return {}
  const key = encryptionKey()
  if (!key) {
    log.error("user keys present but PROFILE_ENCRYPTION_KEY is missing/invalid — treating as key-missing")
    return {}
  }
  const out: UserKeys = {}
  for (const kind of USER_KEY_KINDS) {
    const bundle = file.keys[kind]
    if (!isValidBundle(bundle)) continue
    try {
      const value = decryptSecret(bundle, key)
      if (value) out[kind] = value
    } catch {
      // Tamper o env cambiata: la singola kind degrada ad assente.
      log.error("user key failed to decrypt — treating as missing", { kind })
    }
  }
  return out
}

/** Solo presenza per kind (booleans): nessun valore, nessuna decifratura. */
export async function getUserKeysStatus(userId: string): Promise<Record<UserKeyKind, boolean>> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  return {
    tmdb: isValidBundle(file?.keys.tmdb),
    mdblist: isValidBundle(file?.keys.mdblist),
    tvdb: isValidBundle(file?.keys.tvdb),
  }
}

/**
 * Stato chiavi onesto (presenza + decifrabilità): `present` = bundle salvato,
 * `decryptable` = decifrabile con la PROFILE_ENCRYPTION_KEY corrente.
 * Dopo una rotazione/rimozione dell'env i bundle restano `present:true` ma
 * `decryptable:false` — la UI deve mostrare "da riconfigurare" invece di un
 * verde bugiardo (i cataloghi degradano a key-missing, mai throw).
 */
export interface UserKeysHealth {
  present: Record<UserKeyKind, boolean>
  decryptable: Record<UserKeyKind, boolean>
  encryptionAvailable: boolean
}

export async function getUserKeysHealth(userId: string): Promise<UserKeysHealth> {
  assertValidUserId(userId)
  const file = await readKeysFile(userId)
  const present = {
    tmdb: isValidBundle(file?.keys.tmdb),
    mdblist: isValidBundle(file?.keys.mdblist),
    tvdb: isValidBundle(file?.keys.tvdb),
  }
  const key = encryptionKey()
  if (!key) {
    return { present, decryptable: { tmdb: false, mdblist: false, tvdb: false }, encryptionAvailable: false }
  }
  const decryptable: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false }
  for (const kind of USER_KEY_KINDS) {
    const bundle = file?.keys[kind]
    if (!isValidBundle(bundle)) continue
    try {
      decryptSecret(bundle, key)
      decryptable[kind] = true
    } catch {
      decryptable[kind] = false
    }
  }
  return { present, decryptable, encryptionAvailable: true }
}

const MAX_KEY_LENGTH = 256

function normalizeKeyInput(kind: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new InvalidUserKeyError(kind)
  const v = value.trim()
  if (!v) return null
  if (v.length > MAX_KEY_LENGTH || /[\s]/.test(v)) throw new InvalidUserKeyError(kind)
  return v
}

/**
 * Salva (merge) le chiavi del namespace. `null`/`""` = cancella la kind.
 * Richiede cifratura disponibile quando almeno una kind va scritta (fail-closed:
 * mai chiavi in chiaro a riposo). Le sole cancellazioni passano anche senza env.
 */
export async function setUserKeys(userId: string, input: Partial<Record<UserKeyKind, unknown>>): Promise<void> {
  assertValidUserId(userId)
  const writes: Partial<Record<UserKeyKind, string>> = {}
  const deletes: UserKeyKind[] = []
  for (const kind of USER_KEY_KINDS) {
    if (!(kind in input)) continue
    const normalized = normalizeKeyInput(kind, input[kind])
    if (normalized === null) deletes.push(kind)
    else writes[kind] = normalized
  }
  const current = (await readKeysFile(userId)) ?? { version: 1 as const, keys: {}, updatedAt: new Date().toISOString() }
  for (const kind of deletes) delete current.keys[kind]
  if (Object.keys(writes).length > 0) {
    const key = encryptionKey()
    if (!key) throw new KeysEncryptionUnavailableError()
    for (const [kind, value] of Object.entries(writes) as [UserKeyKind, string][]) {
      current.keys[kind] = encryptSecret(value, key)
    }
  }
  current.updatedAt = new Date().toISOString()
  // Mai i valori nei log: solo le kind toccate.
  log.info("User keys updated", { kinds: [...Object.keys(writes), ...deletes.map((k) => `-${k}`)] })
  if (useKv) {
    const { kv } = await import("@vercel/kv")
    await kv.set(keysKvKey(userId), current)
    return
  }
  await fsp.mkdir(userDir(userId), { recursive: true })
  await fsp.writeFile(keysFile(userId), JSON.stringify(current), { mode: 0o600 })
}
