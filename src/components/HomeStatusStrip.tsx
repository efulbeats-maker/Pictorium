"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/contexts/TranslationContext"
import { APP_VERSION } from "@/generated/app-version"
import { currentPathUuid } from "@/lib/user-token"

export function HomeStatusStrip() {
  const { t } = useT()
  const [statusHref, setStatusHref] = useState("/status")

  useEffect(() => {
    const uuid = currentPathUuid()
    if (uuid) {
      setStatusHref(`/status?u=${encodeURIComponent(uuid)}`)
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
        <span className="hidden sm:inline" aria-hidden="true">Pictorium v{APP_VERSION}</span>
      </div>
    </footer>
  )
}
