import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById, getOrgId } from '@/lib/db/users'
import { getDocument } from '@/lib/db/documents'
import { canViewDocument } from '@/lib/documents/access'
import { logAuditEvent } from '@/lib/audit/log'

// Téléchargement document — action explicite, AUDITÉE distinctement de
// l'ouverture (phase 3, doctrine G). Role-gaté par visibility_level.
// 404 (jamais 403) si non autorisé : on ne révèle pas l'existence.
// Zéro IA. URL signée courte avec disposition download ; jamais le
// storage_path exposé.

const SIGNED_URL_TTL = 120

const notFound = () => new NextResponse('Not found', { status: 404 })

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound()
  const role = await getUserRoleById(user.id)

  const doc = await getDocument(id)
  if (!doc) return notFound()
  if (!canViewDocument(role, doc.visibility_level)) return notFound()
  // P1 isolation : un document d'un autre tenant n'existe pas pour ce user
  // (404, jamais 403). Le rôle admin = super-admin plateforme, seule exception.
  if (role !== 'admin') {
    const orgId = await getOrgId()
    if (!orgId || doc.organization_id !== orgId) return notFound()
  }

  const admin = createAdminClient()
  const { data: signed } = await admin.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL, { download: doc.filename })
  if (!signed?.signedUrl) {
    return new NextResponse('Fichier indisponible', { status: 503 })
  }

  await logAuditEvent({
    userId: user.id,
    entityType: 'document',
    entityId: doc.id,
    action: 'downloaded',
    metadata: { filename: doc.filename, document_type: doc.document_type },
  })

  return NextResponse.redirect(signed.signedUrl)
}
