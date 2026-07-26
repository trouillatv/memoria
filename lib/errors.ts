/**
 * Message d'erreur lisible depuis une valeur levée quelconque.
 *
 * Les erreurs Supabase/Postgrest ne sont PAS des instances d'`Error` : ce sont
 * des objets `{ message, details, hint, code }`. `String(e)` sur eux produit
 * « [object Object] » et masque la vraie cause. On extrait ici le message le
 * plus informatif possible, sans jamais retomber sur « [object Object] ».
 */
export function readableError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const parts = [o.message, o.details, o.hint, o.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}
