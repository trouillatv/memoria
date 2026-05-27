import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase avec service role — bypass des RLS.
 * À utiliser UNIQUEMENT côté serveur, dans des Server Actions privilégiées
 * (ex. inviteUser, force password reset, écriture audit logs).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
