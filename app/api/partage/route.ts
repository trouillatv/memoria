// LA PORTE — ce que Android POSTe quand Guillaume fait « Partager → MemorIA ».
//
// Elle ne crée RIEN dans la mémoire du chantier : elle met les fichiers de côté
// (le sas) et envoie Guillaume choisir le chantier. Tant qu'il n'a pas choisi,
// aucune visite n'existe.
//
//     WhatsApp → Partager → [ici] → /m/partage → chantier → importé
//
// ⚠️ Le proxy laisse passer /api/* : l'authentification se fait DANS le handler.

import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireFieldAgent } from '@/lib/auth/require'
import { stageFile } from '@/lib/share/staging'
import { acceptShared, type ShareRejection } from '@/lib/share/share-rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Un écran, pas un JSON : Guillaume arrive ici depuis son téléphone. */
function fail(req: NextRequest, reason: ShareRejection | 'stockage'): NextResponse {
  const url = new URL('/m/partage', req.url)
  url.searchParams.set('erreur', reason)
  return NextResponse.redirect(url, 303)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireFieldAgent()
  if (!auth.ok || !auth.userId) {
    // Session expirée : on ne peut pas garder les fichiers, mais on le DIT.
    return NextResponse.redirect(new URL('/login?next=/m', req.url), 303)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return fail(req, 'trop-lourd')
  }

  const verdict = acceptShared(form.getAll('files').filter((f): f is File => f instanceof File))
  if (!verdict.ok) return fail(req, verdict.reason)
  const accepted = verdict.files

  const lotId = randomUUID()
  try {
    // Séquentiel : l'ordre d'arrivée est l'ordre des photos dans WhatsApp, et
    // c'est souvent l'ordre chronologique de la visite.
    for (let i = 0; i < accepted.length; i += 1) {
      await stageFile({ userId: auth.userId, lotId, index: i, file: accepted[i] })
    }
  } catch {
    return fail(req, 'stockage')
  }

  const url = new URL('/m/partage', req.url)
  url.searchParams.set('lot', lotId)
  // 303 : le POST d'Android devient un GET — sinon le rechargement rejouerait
  // l'envoi.
  return NextResponse.redirect(url, 303)
}
