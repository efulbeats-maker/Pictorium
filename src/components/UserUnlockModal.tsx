"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Copy, KeyRound, X } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import {
  currentPathUuid,
  isUserUnlocked,
  setStoredUserPassword,
  setStoredUserToken,
  USER_UNLOCK_EVENT,
  USER_UNLOCK_REQUEST_EVENT,
} from "@/lib/user-token"

/**
 * Sblocco proprietario (multi-user, stile AIOmetadata): solo sui path `/u/<uuid>`.
 * Chiede all'apertura (salvo sessione già sbloccata): password (verifica
 * server, vive in memoria di sessione) o secret (verificato sul server prima
 * di accettarlo, tenuto in memoria di sessione). Zero persistenza: ogni
 * refresh dimentica tutto e richiede di nuovo le credenziali; l'unico rientro
 * esterno è il pulsante "modifica config" di Stremio/Nuvio.
 *
 * - Recovery `#key=<secret>`: usato in memoria e rimosso dall'URL (mai in
 *   HTTP/log, mai salvato), sblocca subito senza modal (gesto esplicito).
 * - Senza nulla (ospite): modal chiudibile SOLO con la X esplicita (mai per
 *   click fuori), sola lettura. A modal chiuso resta una pill "Accedi".
 * - Riapertura su richiesta (icona UUID): evento USER_UNLOCK_REQUEST_EVENT.
 * - Allo sblocco emette USER_UNLOCK_EVENT (hook/editor ricaricano il namespace).
 */
export function UserUnlockModal() {
  const { t } = useT()
  const [uuid, setUuid] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // Pill "Accedi" nascosta per sessione (ospite intenzionale): mai nagging,
  // ma il rientro resta a un tap finché non si ricarica.
  const [pillDismissed, setPillDismissed] = useState(false)
  // Re-render allo sblocco così la pill sparisce senza refresh.
  const [, setUnlockTick] = useState(0)
  const [mode, setMode] = useState<"password" | "secret">("password")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const unlock = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent(USER_UNLOCK_EVENT, { detail: { uuid: id } }))
  }, [])

  useEffect(() => {
    const onUnlock = () => setUnlockTick((n) => n + 1)
    window.addEventListener(USER_UNLOCK_EVENT, onUnlock)
    return () => window.removeEventListener(USER_UNLOCK_EVENT, onUnlock)
  }, [])

  // Riapertura su richiesta (icona UUID nella toolbar): solo se c'è uno uuid
  // e non è già sbloccato (mai popup a caso).
  useEffect(() => {
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<{ uuid?: string }>).detail
      const id = (typeof detail?.uuid === "string" && detail.uuid) || currentPathUuid()
      if (!id) return
      setUuid(id)
      if (isUserUnlocked(id)) return
      setPillDismissed(false)
      setOpen(true)
    }
    window.addEventListener(USER_UNLOCK_REQUEST_EVENT, onRequest)
    return () => window.removeEventListener(USER_UNLOCK_REQUEST_EVENT, onRequest)
  }, [])
  useEffect(() => {
    const syncUuid = () => {
      const id = currentPathUuid()
      setUuid((prev) => (prev === id ? prev : id))
    }
    window.addEventListener("popstate", syncUuid)
    return () => window.removeEventListener("popstate", syncUuid)
  }, [])

  // Guardia mount-once: l'effect dipende da `t` (cambia identità al cambio
  // lingua) ma l'auto-apertura vale solo al primo giro — senza, il modal
  // riappariva da solo a chi l'aveva chiuso apposta.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const id = currentPathUuid()
    setUuid(id)
    if (!id) return
    // Recovery da hash fragment: usato in memoria di sessione e rimosso
    // dall'URL (mai in HTTP/log, mai salvato da nessuna parte).
    try {
      const hash = window.location.hash
      const m = hash.match(/(?:^#|&)key=([^&]+)/)
      if (m?.[1]) {
        const secret = decodeURIComponent(m[1]).trim()
        if (secret) {
          setStoredUserToken(id, secret)
          window.history.replaceState(null, "", window.location.pathname + window.location.search)
          unlock(id)
          toast.success(t("ui.userKeysSaved"))
          return
        }
      }
    } catch {
      /* URL/hash non disponibili */
    }
    // Sessione già sbloccata (es. login dal gate e poi navigazione qui):
    // niente prompt duplicato, si entra diretti.
    if (isUserUnlocked(id)) return
    // Stile AIO: prompt a ogni apertura senza sblocco, mai auto-login.
    setOpen(true)
  }, [t, unlock])

  const savePassword = useCallback(async () => {
    const v = input
    if (!v || !uuid || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/users/${uuid}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: v }),
      })
      if (!res.ok) {
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      setStoredUserPassword(uuid, v)
      setInput("")
      setOpen(false)
      unlock(uuid)
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }, [input, uuid, busy, t, unlock])

  const saveSecret = useCallback(async () => {
    const v = input.trim()
    if (!v || !uuid || busy) return
    // Il secret va verificato sul server PRIMA di accettarlo: prima un typo
    // chiudeva il modal con toast di successo e lasciava un "unlock" che poi
    // 401ava ovunque (chiavi invisibili, nessun errore chiaro al login).
    setBusy(true)
    try {
      const res = await fetch(`/api/users/${uuid}/keys`, { headers: { "x-user-token": v } })
      if (res.status === 404) {
        toast.error(t("ui.userKeysConnError"))
        return
      }
      if (!res.ok) {
        toast.error(t("ui.userKeysAuthError"))
        return
      }
      setStoredUserToken(uuid, v)
      setInput("")
      setOpen(false)
      unlock(uuid)
      toast.success(t("ui.userKeysSaved"))
    } catch {
      toast.error(t("ui.userKeysConnError"))
    } finally {
      setBusy(false)
    }
  }, [input, uuid, busy, t, unlock])

  const copyUuid = useCallback(async () => {
    if (!uuid) return
    try {
      await navigator.clipboard.writeText(uuid)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard non disponibile */
    }
  }, [uuid])

  if (!uuid) return null

  // Modal chiuso ma spazio ancora bloccato: pill persistente di rientro (il
  // dismiss con la X non è più un vicolo cieco). Nascosta per sessione alla X
  // (ospite intenzionale) e sparisce da sola allo sblocco (unlock tick).
  if (!open && !isUserUnlocked(uuid) && !pillDismissed) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
        <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border border-white/10 bg-surface shadow-2xl">
          <KeyRound className="w-3.5 h-3.5 text-accent-orange shrink-0" />
          <span className="text-[11px] text-zinc-300 whitespace-nowrap">{t("ui.userUnlockTitle")}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors cursor-pointer"
          >
            {t("ui.userUnlockOpen")}
          </button>
          <button
            type="button"
            onClick={() => setPillDismissed(true)}
            aria-label={t("ui.close")}
            className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-all cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  if (!open) return null

  return (
    // Niente dismiss da backdrop: il click fuori chiudeva per sbaglio (dita
    // mobili) e senza rientro l'unica via era il refresh. Solo la X esplicita.
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl p-5 space-y-3"
        role="dialog"
        aria-modal="true"
        aria-label={t("ui.userUnlockTitle")}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-accent-orange" />
            {t("ui.userUnlockTitle")}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("ui.close")}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface2 hover:bg-zinc-700 text-muted hover:text-zinc-200 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted leading-relaxed">{t("ui.userUnlockDesc")}</p>
        <div>
          <span className="text-[10px] text-muted block mb-1">{t("ui.userSpaceUuidLabel")}</span>
          <button
            type="button"
            onClick={() => void copyUuid()}
            title={t("ui.copyUuid")}
            className="w-full flex items-center justify-between gap-2 font-mono text-[11px] py-2 px-3 rounded-lg bg-black/40 border border-white/10 text-zinc-200 hover:border-accent-orange/50 transition-colors cursor-pointer"
          >
            <span className="truncate">{uuid}</span>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
          </button>
        </div>
        {mode === "password" ? (
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userUnlockPasswordLabel")}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void savePassword() }}
              placeholder="••••••••"
              className="w-full font-mono text-xs py-2 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
        ) : (
          <div>
            <label className="text-[10px] text-muted block mb-1">{t("ui.userKeysTokenLabel")}</label>
            <input
              type="password"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveSecret() }}
              placeholder="••••••••"
              className="w-full font-mono text-xs py-2 px-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder-zinc-600 focus:outline-none focus:border-accent-orange/50"
            />
          </div>
        )}
        <button
          type="button"
          disabled={!input || busy}
          onClick={() => void (mode === "password" ? savePassword() : saveSecret())}
          className="w-full py-2 rounded-lg text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          {busy ? t("ui.saving") : t("ui.save")}
        </button>
        <button
          type="button"
          onClick={() => { setMode((m) => (m === "password" ? "secret" : "password")); setInput("") }}
          className="w-full text-center text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          {mode === "password" ? t("ui.userUnlockUseSecret") : t("ui.userUnlockUsePassword")}
        </button>
      </div>
    </div>
  )
}
