import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getDocument } from '@/lib/db/documents'
import { canViewDocument } from '@/lib/documents/access'
import { logAuditEvent } from '@/lib/audit/log'

// Visionneuse documentaire — phase 3 (spec 2026-05-19).
// Doctrine : artefact mémoire relisible + audité, role-gaté par
// visibility_level, JAMAIS une fiche personne. Zéro IA, zéro résumé.
// notFound() (pas 403) si non autorisé : on ne révèle pas l'existence.

const SIGNED_URL_TTL = 300 // 5 min — URL signée courte, jamais le storage_path

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

const ANALYSIS_LABEL: Record<string, string> = {
  pending: 'En attente',
  extracting: 'Extraction',
  ocr: 'OCR',
  chunking: 'Indexation',
  ready: 'Prêt',
  failed: 'Échec',
}

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Auth + rôle
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const role = await getUserRoleById(user.id)

  const doc = await getDocument(id)
  if (!doc) notFound()

  // Accès role-gaté par visibility_level. notFound, pas 403.
  if (!canViewDocument(role, doc.visibility_level)) notFound()

  // URL signée courte (jamais le storage_path côté client). Aperçu inline :
  // pas de disposition "download" (le téléchargement audité passe par la
  // route dédiée /documents/[id]/download).
  const admin = createAdminClient()
  const { data: signed } = await admin.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL)
  const signedUrl = signed?.signedUrl ?? null

  // Nom de collection (métadonnée).
  const { data: col } = await admin
    .from('document_collections')
    .select('name')
    .eq('id', doc.collection_id)
    .maybeSingle()
  const collectionName = (col as { name?: string } | null)?.name ?? '—'

  // Audit OUVERTURE — une fois par chargement de page (pas en boucle render).
  await logAuditEvent({
    userId: user.id,
    entityType: 'document',
    entityId: doc.id,
    action: 'opened',
    metadata: { filename: doc.filename, document_type: doc.document_type },
  })

  const lower = doc.filename.toLowerCase()
  const isPdf = lower.endsWith('.pdf')
  const isImage = /\.(png|jpe?g|gif|webp|avif)$/.test(lower)

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Bibliothèque documentaire
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold break-words">{doc.filename}</h1>
        <p className="text-sm text-muted-foreground">
          {doc.document_type} · {ANALYSIS_LABEL[doc.analysis_status] ?? doc.analysis_status}
          {doc.analysis_status === 'failed' && doc.failed_reason
            ? ` — ${doc.failed_reason}`
            : ''}
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Métadonnées
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Collection</dt>
            <dd className="font-medium">{collectionName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Visibilité</dt>
            <dd className="font-medium">{doc.visibility_level}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Statut</dt>
            <dd className="font-medium">
              {ANALYSIS_LABEL[doc.analysis_status] ?? doc.analysis_status}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cycle de vie</dt>
            <dd className="font-medium">{doc.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Effet</dt>
            <dd className="font-medium">{frDate(doc.effective_date)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Échéance</dt>
            <dd className="font-medium">{frDate(doc.expires_date)}</dd>
          </div>
          {doc.tags.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <dt className="text-xs text-muted-foreground">Tags</dt>
              <dd className="font-medium">{doc.tags.join(' · ')}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Source
          </h2>
          <Link
            href={`/documents/${doc.id}/download`}
            prefetch={false}
            className="text-sm underline hover:text-foreground"
          >
            Télécharger
          </Link>
        </div>
        {!signedUrl ? (
          <p className="text-sm text-muted-foreground">
            Fichier indisponible. Réessayez plus tard.
          </p>
        ) : isPdf ? (
          <iframe
            src={signedUrl}
            title={doc.filename}
            className="w-full h-[70vh] rounded border"
          />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signedUrl} alt={doc.filename} className="max-w-full rounded border" />
        ) : (
          <a
            href={`/documents/${doc.id}/download`}
            className="text-sm underline hover:text-foreground"
          >
            Ouvrir / télécharger le document
          </a>
        )}
      </section>
    </div>
  )
}
