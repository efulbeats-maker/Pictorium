"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/contexts/TranslationContext"
import { APP_VERSION } from "@/generated/app-version"
import { currentPathUuid } from "@/lib/user-token"

export function HomeStatusStrip() {
  const { t } = useT()
  const [statusHref, setStatusHref] = useState("/status")
  // Occupazione spazi (solo multi-user): resta nascosto finché il dato non
  // arriva o se l'endpoint fallisce — nessun layout shift, nessun errore.
  const [spaces, setSpaces] = useState<{ users: number; maxUsers: number } | null>(null)

  useEffect(() => {
    const uuid = currentPathUuid()
    if (uuid) {
      setStatusHref(`/status?u=${encodeURIComponent(uuid)}`)
    }
    let cancelled = false
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.multiUser === true && typeof d.users === "number") {
          setSpaces({ users: d.users, maxUsers: typeof d.maxUsers === "number" ? d.maxUsers : 0 })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="status-strip max-w-5xl mx-auto mt-10" data-testid="home-status">
      <div className="status-left">
        <span className="pulse-dot" aria-hidden="true" />
        <span>{t("ui.allSystemsOperational")}</span>{" "}
        <span className="status-meta hidden sm:inline" aria-hidden="true">{t("ui.statusMeta")}</span>
      </div>
      <div className="status-right">
        <Link href={statusHref} className="status-link" suppressHydrationWarning>
          {t("ui.statusTitle")}
        </Link>
        {spaces !== null && (
          <span data-testid="home-spaces">
            {spaces.maxUsers > 0
              ? t("ui.spacesUsedOf", { used: spaces.users, max: spaces.maxUsers })
              : t("ui.spacesUsed", { used: spaces.users })}
          </span>
        )}
        <span className="hidden sm:inline" aria-hidden="true">Pictorium v{APP_VERSION}</span>
      </div>
    </footer>
  )
}
