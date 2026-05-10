import '@testing-library/jest-dom'
import { config as loadDotenv } from 'dotenv'
import path from 'path'

// Load env vars from .env.local for tests that hit real Supabase.
// Existing tests that mock Supabase are unaffected.
loadDotenv({ path: path.resolve(process.cwd(), '.env.local') })
