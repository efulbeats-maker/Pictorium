"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { copyText } from "@/lib/clipboard"
import {
  currentPathUuid,
  fetchWithUserAuthRetry,
  getStoredUserPassword,
  getStoredUserToken,
  isUserUnlocked,
  USER_UNLOCK_EVENT,
} from "@/lib/user-token"
import type { UserKeyKind } from "@/lib/user-keys"

const KINDS: readonly UserKeyKind[] = ["tmdb", "mdblist", "tvdb"]

// Contratto token col resto dell'app (ri-esportato per compatibilità):
// secret di sessione, MAI in URL/query/log.
export { getStoredUserToken, setStoredUserToken } from "@/lib/user-token"

function safeGetItem(key: string): string {
  try {
    if (typeof window === "undefined" || !window.localStorage) return ""
    return window.localStorage.getItem(key) || ""
  } catch {
    return ""
  }
}

/**
 * Riga chiave singola (label + input + occhio + copia): UNICO layout per
 * recovery e kind, così è impossibile che una riga wrappi e l'altra no.
 */
function KeyRow({
  label,
  badge,
  value,
  placeholder,
  readOnly,
  onChange,
  onFocus,
  show,
  onToggleShow,
  showTitle,
  hideTitle,
  canCopy,
  onCopy,
  copied,
  copyTitle,
  disabled,
}: {
  label: React.ReactNode
  badge?: React.ReactNode
  value: string
  placeholder?: string
  readOnly?: boolean
  onChange?: (v: string) => void
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  show: boolean
  onToggleShow: () => void
  showTitle: string
  hideTitle: string
  canCopy: boolean
  onCopy: () => void
  copied: boolean
  copyTitle: string
  disabled?: boolean
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-muted uppercase tracking-wide">{label}</label>
        {badge}
      </div>
      <div className="flex flex-nowrap gap-2">
        <input
          type={show ? "text" : "password"}
          readOnly={readOnly}
          autoComplete="off"
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          onFocus={onFocus}
          placeholder={placeholder}
          className="flex-1 min-w-0 w-0 font-mono text-xs py-1.5 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleShow}
          title={show ? hideTitle : showTitle}
          aria-label={show ? hideTitle : showTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <button
          type="button"
          disabled={!canCopy}
          onClick={onCopy}
          title={copyTitle}
          aria-label={copyTitle}
          className="w-9 h-9 shrink-0 grow-0 basis-auto flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-zinc-300 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

const SAVED_KEY_MASKS: Record<UserKeyKind, string> = {
  tmdb: "••••••••••••••••••••••••••••••••", // 32 caratteri (hex TMDB)
  mdblist: "••••••••••••••••••••••••••••", // 28 caratteri (MDBList)
  tvdb: "••••••••••••••••••••••••••••••••", // 32 caratteri (TVDB)
}

const DEVICE_KEY_NAMES: Record<UserKeyKind, string> = {
  tmdb: "tmdb_key",
  mdblist: "mdblist_key",
  tvdb: "tvdb_key",
}

/**
 * Chiavi API server-side del namespace (`/u/<uuid>/configure`).
 * Null fuori dai path utente. Di default i valori non tornano mai dal server
 * (solo booleani di presenza): gli input si precompilano dalle chiavi già presenti
 * su questo dispositivo (localStorage) quando sul server non c'è nulla.
 * L'occhio/copia su riga salvata ma vuota usa il reveal autenticato
 * (`POST .../keys/reveal`), mai un elenco.
 * Il PUT viaggia con `x-user-token` e invia solo i campi modificati
 * (svuotare un campo modificato = cancellare la chiave server-side).
 */
export function UserKeysSection() {
  const { t } = useT()
  const [uuid, setUuid] = useState<string | null>(null)
  const [token, setToken] = useState("")
  const [status, setStatus] = useState<Record<UserKeyKind, boolean> | null>(null)
  const [values, setValues] = useState<Record<UserKeyKind, string>>({ tmdb: "", mdblist: "", tvdb: "" })
  const [dirty, setDirty] = useState<Record<UserKeyKind, boolean>>({ tmdb: false, mdblist: false, tvdb: false })
  const [busy, setBusy] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  // Mostra/copia: valori digitati oppure rivelati dal server su richiesta
  // esplicita (reveal autenticato, mai in elenco). Dopo refresh/restart una
  // chiave salvata si rivela così, senza ridigitarla.
  const [show, setShow] = useState<Record<UserKeyKind, boolean>>({ tmdb: false, mdblist: false, tvdb: false })
  const [copiedKind, setCopiedKind] = useState<UserKeyKind | null>(null)
  const [revealingKind, setRevealingKind] = useState<UserKeyKind | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const refresh = useCallback((id: string) => {
    const stored = getStoredUserToken(id) || ""
    setToken(stored)
    // Riuso chiavi del dispositivo: precompila solo a status noto e assente.
    const prefill: Record<UserKeyKind, string> = { tmdb: "", mdblist: "", tvdb: "" }
    for (const kind of KINDS) prefill[kind] = safeGetItem(DEVICE_KEY_NAMES[kind])
    // Auth: secret oppure password di sessione (stile AIO). Il retry interno
    // copre il secret stantio che oscura la password fresca (niente refresh
    // pagina per farlo sparire).
    fetchWithUserAuthRetry(id, `/api/users/${id}/keys`)
      .then((r) => {
        if (r.status === 401) {
          setUnauthorized(true)
          setStatus(null)
          return null
        }
        if (!r.ok) return null
        return r.json()
      })
      .then((data) => {
        if (!data) return
        setUnauthorized(false)
        const next: Record<UserKeyKind, boolean> = { tmdb: false, mdblist: false, tvdb: false }
        for (const kind of KINDS) next[kind] = data[kind] === true
        setStatus(next)
        // Mai eco di segreti dal server; mai cancellare il digitato: riempi
        // solo i vuoti quando il server non ha nulla (prefill dispositivo).
        // Così il save (che scatena questo refresh via evento) non vaporizza
        // la chiave appena salvata, ora visibile/copiabile.
        setValues((prev) => {
          const vals = { ...prev }
          for (const kind of KINDS) {
            if (!next[kind] && !vals[kind]) vals[kind] = prefill[kind]
          }
          return vals
        })
        setDirty({ tmdb: false, mdblist: false, tvdb: false })
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    const id = currentPathUuid()
    setUuid(id)
    if (!id) return
    refresh(id)
    // Ricarica dopo lo sblocco (unlock modal / #key= recovery). L'id si
    // rilegge a ogni evento (non quello del mount): back/forward e SPA che
    // riusano l'albero lascerebbero la sezione sullo spazio precedente.
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ uuid?: string }>).detail
      const target = detail?.uuid || currentPathUuid() || id
      if (!target) return
      setUuid(target)
      refresh(target)
    }
    const onPop = () => {
      const liveId = currentPathUuid()
      setUuid(liveId)
      if (liveId) refresh(liveId)
    }
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
      window.removeEventListener("popstate", onPop)
    }
  }, [refresh])

  const toggleShow = useCallback((kind: UserKeyKind) => {
    setShow((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }, [])

  const copyValue = useCallback(async (kind: UserKeyKind, value: string) => {
    if (!value) return
    if (!(await copyText(value))) return
    setCopiedKind(kind)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedKind(null), 2000)
  }, [])

  // Riempie values[kind] dal server se manca (reveal autenticato + mostralo).
  // Ritorna il valore o "" (401/404/errore già notificati qui).
  const ensureValue = useCallback(async (kind: UserKeyKind): Promise<string> => {
    if (values[kind]) return values[kind]
    if (!uuid || !status?.[kind]) return ""
    setRevealingKind(kind)
    try {
      // Retry anti secret-stantio come il refresh (stesso 401 fantasma).
      const res = await fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return ""
      }
      if (!res.ok) {
        if (res.status !== 404) toast.error(t("ui.userKeysSaveError"))
        return ""
      }
      const data = await res.json().catch(() => null)
      const v = typeof data?.value === "string" ? data.value : ""
      if (v) {
        setValues((prev) => ({ ...prev, [kind]: v }))
        setShow((prev) => ({ ...prev, [kind]: true }))
      }
      return v
    } catch {
      toast.error(t("ui.userKeysConnError"))
      return ""
    } finally {
      setRevealingKind(null)
    }
  }, [values, uuid, status, t])

  if (!uuid || !isUserUnlocked(uuid)) return null

  const save = async () => {
    if (!uuid || busy) return
    const payload: Partial<Record<UserKeyKind, string>> = {}
    for (const kind of KINDS) {
      if (dirty[kind]) payload[kind] = values[kind].trim()
    }
    if (Object.keys(payload).length === 0) return
    setBusy(true)
    try {
      // Retry anti secret-stantio: senza, un secret marcio + password fresca
      // farebbe fallire il save con toast d'errore ingiusto.
      const res = await fetchWithUserAuthRetry(uuid, `/api/users/${uuid}/keys`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.status === 401) {
        setUnauthorized(true)
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      if (res.status === 503) {
        toast.error(t("ui.userKeysEncryptionError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.userKeysSaveError"))
        return
      }
      const data = await res.json().catch(() => null)
      if (data?.keys) {
        const next = { ...status, ...data.keys } as Record<UserKeyKind, boolean>
        setStatus(next)
        // I valori restano negli input dopo il save (occhio/copia devono
        // funzionare anche a chiave salvata: il server non li restituisce
        // mai). Si azzerano solo al refresh — da lì serve ridigitarli.
        setDirty({ tmdb: false, mdblist: false, tvdb: false })
        // Riallinea lo status chiavi del context (gate ricerca/hero): senza,
        // resterebbe stantio fino al refresh e i poster non partirebbero.
        // Stesso idioma del cambio password in UserSpaceSection.
        window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid } }))
      }
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }

  const hasDirty = dirty.tmdb || dirty.mdblist || dirty.tvdb
  // Sblocco via secret salvato sul dispositivo oppure password di sessione
  // (unlock modal). Il secret si incolla solo nel modal, mai qui.
  const hasCredential = !!token.trim() || (!!uuid && !!getStoredUserPassword(uuid))

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-accent-orange" />
        {t("ui.userKeysTitle")}
      </span>
      <p className="text-[11px] text-muted leading-relaxed">{t("ui.userKeysDesc")}</p>
      {(unauthorized || !hasCredential) && (
        <p className="text-[10px] text-amber-300/90">{t("ui.userKeysTokenHint")}</p>
      )}
      {KINDS.map((kind) => {
        const isMasked = !!status?.[kind] && !dirty[kind] && !values[kind]
        const displayValue = isMasked ? (show[kind] ? "" : SAVED_KEY_MASKS[kind]) : values[kind]
        return (
          <KeyRow
            key={kind}
            label={kind}
            badge={
              status ? (
                <span className={`text-[10px] font-medium ${status[kind] ? "text-emerald-400" : "text-zinc-500"}`}>
                  {status[kind] ? t("ui.userKeysSet") : t("ui.userKeysUnset")}
                </span>
              ) : undefined
            }
            value={displayValue}
            placeholder=""
            onFocus={(e) => {
              if (isMasked) {
                e.currentTarget.select()
              }
            }}
            onChange={(v) => {
              const nextVal = isMasked ? v.replaceAll("•", "") : v
              setValues((prev) => ({ ...prev, [kind]: nextVal }))
              setDirty((prev) => ({ ...prev, [kind]: true }))
            }}
            show={show[kind]}
            onToggleShow={() => {
              // Valore presente: toggle locale. Salvata ma vuota (post
              // refresh): reveal dal server e mostrala.
              if (values[kind] || !status?.[kind]) toggleShow(kind)
              else void ensureValue(kind)
            }}
            showTitle={t("ui.showKey")}
            hideTitle={t("ui.hideKey")}
            canCopy={(!!values[kind] || !!status?.[kind]) && revealingKind !== kind}
            onCopy={() => {
              void (async () => {
                const v = values[kind] || (await ensureValue(kind))
                if (v) void copyValue(kind, v)
              })()
            }}
            copied={copiedKind === kind}
            copyTitle={t("ui.copyUuid")}
            disabled={revealingKind === kind}
          />
        )
      })}
      <button
        type="button"
        disabled={!hasDirty || busy || !hasCredential}
        onClick={() => void save()}
        className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
      >
        {busy ? t("ui.saving") : t("ui.save")}
      </button>
    </div>
  )
}
