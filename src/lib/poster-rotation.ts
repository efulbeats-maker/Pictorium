import type { Mapping } from "@/lib/types"
import { upsert } from "@/lib/store"

export interface EffectiveRotationState {
  readonly availablePosters: readonly string[]
  readonly isRotating: boolean
}

export interface EffectiveBackdropRotationState {
  readonly availableBackdrops: readonly string[]
  readonly isRotating: boolean
}

export function getEffectiveRotationState(mapping: Mapping | null): EffectiveRotationState {
  if (!mapping?.autoRotateClean || !mapping.cleanPosters || mapping.cleanPosters.length < 2) {
    return { availablePosters: [], isRotating: false }
  }

  const excludedSet = new Set(mapping.excludedPosters || [])
  const availablePosters = mapping.cleanPosters.filter((path) => !excludedSet.has(path))
  return {
    availablePosters,
    isRotating: availablePosters.length >= 2,
  }
}

/**
 * Stato di rotazione degli sfondi landscape (mirror dei poster verticali):
 * richiede autoRotateBackdrop + almeno 2 backdrop non esclusi.
 */
export function getEffectiveBackdropRotationState(mapping: Mapping | null): EffectiveBackdropRotationState {
  if (!mapping?.autoRotateBackdrop || !mapping.cleanBackdrops || mapping.cleanBackdrops.length < 2) {
    return { availableBackdrops: [], isRotating: false }
  }

  const excludedSet = new Set(mapping.excludedBackdrops || [])
  const availableBackdrops = mapping.cleanBackdrops.filter((path) => !excludedSet.has(path))
  return {
    availableBackdrops,
    isRotating: availableBackdrops.length >= 2,
  }
}

// ---- Per-poster mutex for safe concurrent rotation ----

const rotationLocks = new Map<string, Promise<void>>()

/**
 * Acquire a per-id lock, run `fn`, then release.
 * Guarantees at most one rotation write per poster at a time.
 */
export async function withRotationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (true) {
    const existing = rotationLocks.get(key)
    if (!existing) {
      // No lock — create one
      let resolveLock: () => void = () => {}
      const lock = new Promise<void>((resolve) => { resolveLock = resolve })
      rotationLocks.set(key, lock)
      try {
        return await fn()
      } finally {
        rotationLocks.delete(key)
        resolveLock()
      }
    }
    // Wait for the existing lock to finish, then retry
    await existing
  }
}

/**
 * Check if a poster needs rotation, and atomically advance it.
 * Returns the updated mapping if rotation occurred, or null if no change needed.
 * The caller should replace their local mapping reference with the returned one.
 */
export async function tryRotatePoster(
  mapping: Mapping,
  rotationState: EffectiveRotationState,
): Promise<Mapping | null> {
  if (!rotationState.isRotating || rotationState.availablePosters.length < 2) {
    return null
  }

  const key = `${mapping.mediaType}:${mapping.tmdbId}`
  return withRotationLock(key, async () => {
    // Re-read mapping from store to get the latest state
    const { getById } = await import("@/lib/store")
    const currentMapping = await getById(mapping.mediaType, mapping.tmdbId)
    if (!currentMapping) return null

    const lastUpdate = currentMapping.cleanPosterUpdatedAt
      ? new Date(currentMapping.cleanPosterUpdatedAt).getTime() : 0
    const now = Date.now()
    if (now - lastUpdate <= 24 * 60 * 60 * 1000) {
      return null
    }

    // Recompute rotation state with current data
    const excludedSet = new Set(currentMapping.excludedPosters || [])
    const currentAvailable = (currentMapping.cleanPosters || [])
      .filter((path) => !excludedSet.has(path))
    if (currentAvailable.length < 2) return null

    const currentIdx = currentMapping.cleanPosterIndex ?? -1
    const newIndex = currentIdx < 0 ? 0 : (currentIdx + 1) % currentAvailable.length
    const newPosterPath = currentAvailable[newIndex]

    if (newPosterPath === currentMapping.posterPath) {
      // Same path — just update the timestamp
      currentMapping.cleanPosterUpdatedAt = new Date(now).toISOString()
      currentMapping.updatedAt = new Date(now).toISOString()
      await upsert(currentMapping)
      return null
    }

    currentMapping.posterPath = newPosterPath
    currentMapping.cleanPosterIndex = newIndex
    currentMapping.cleanPosterUpdatedAt = new Date(now).toISOString()
    currentMapping.updatedAt = new Date(now).toISOString()
    await upsert(currentMapping)
    return currentMapping
  })
}

/**
 * Rotazione 24h dello sfondo landscape (mirror di tryRotatePoster): avanza
 * `backdropPath` tra i backdrop disponibili. Stessa riga mapping dei poster,
 * quindi stesso lock per-id (niente race tra le due rotazioni).
 * Ritorna il mapping aggiornato o null se non serve ruotare.
 */
export async function tryRotateBackdrop(
  mapping: Mapping,
  rotationState: EffectiveBackdropRotationState,
): Promise<Mapping | null> {
  if (!rotationState.isRotating || rotationState.availableBackdrops.length < 2) {
    return null
  }

  const key = `${mapping.mediaType}:${mapping.tmdbId}`
  return withRotationLock(key, async () => {
    const { getById } = await import("@/lib/store")
    const currentMapping = await getById(mapping.mediaType, mapping.tmdbId)
    if (!currentMapping) return null

    const lastUpdate = currentMapping.cleanBackdropUpdatedAt
      ? new Date(currentMapping.cleanBackdropUpdatedAt).getTime() : 0
    const now = Date.now()
    if (now - lastUpdate <= 24 * 60 * 60 * 1000) {
      return null
    }

    const excludedSet = new Set(currentMapping.excludedBackdrops || [])
    const currentAvailable = (currentMapping.cleanBackdrops || [])
      .filter((path) => !excludedSet.has(path))
    if (currentAvailable.length < 2) return null

    const currentIdx = currentMapping.cleanBackdropIndex ?? -1
    const newIndex = currentIdx < 0 ? 0 : (currentIdx + 1) % currentAvailable.length
    const newBackdropPath = currentAvailable[newIndex]

    if (newBackdropPath === currentMapping.backdropPath) {
      currentMapping.cleanBackdropUpdatedAt = new Date(now).toISOString()
      currentMapping.updatedAt = new Date(now).toISOString()
      await upsert(currentMapping)
      return null
    }

    currentMapping.backdropPath = newBackdropPath
    currentMapping.cleanBackdropIndex = newIndex
    currentMapping.cleanBackdropUpdatedAt = new Date(now).toISOString()
    currentMapping.updatedAt = new Date(now).toISOString()
    await upsert(currentMapping)
    return currentMapping
  })
}
