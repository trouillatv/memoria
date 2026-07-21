import '@testing-library/jest-dom'
import { config as loadDotenv } from 'dotenv'
import path from 'path'

// Load env vars from .env.local for tests that hit real Supabase.
// Existing tests that mock Supabase are unaffected.
loadDotenv({ path: path.resolve(process.cwd(), '.env.local') })

// jsdom n'implémente pas IntersectionObserver : un composant qui s'en sert pour
// suivre la lecture (sommaire du récit de visite) planterait au montage. Le
// bouchon ne simule aucun défilement — il rend seulement le composant montable.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
    root = null
    rootMargin = ''
    thresholds: ReadonlyArray<number> = []
  } as unknown as typeof IntersectionObserver
}
