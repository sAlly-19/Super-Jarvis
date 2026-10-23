// src/main/generated/build-flavor.ts
// Defines the current build target flavor: 'commercial' (release default) or 'smoke' (ephemeral test).

export type BuildFlavor = 'commercial' | 'smoke'

export const BUILD_FLAVOR: BuildFlavor = 'commercial'

export const SMOKE_KEY_ID = 'smoke-ephemeral-2026'

export const SMOKE_PUBLIC_KEY: Readonly<JsonWebKey> | null = null

