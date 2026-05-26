import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getDocument, getDocumentLinkLabels } from '@/lib/db/documents'
import { listContracts } from '@/lib/db/contracts'
import { listSites, listClients } from '@/lib/db/sites'
import { listTenders } from '@/lib/db/tenders'
import { listTeams } from '@/lib/db/teams'
import { indexationState } from '@/lib/documents/labels'
import { canViewDocument } from '@/lib/documents/access'
import { logAuditEvent } from '@/lib/audit/log'
import { getAverageCostForFeatures } from '@/lib/db/ai-usage-rollup'
import { memoryState, MEMORY_STATE_LABEL, MEMORY_STATE_MEANING } from '@/lib/memory/temps-memoriel'
import { DocumentActions } from './DocumentActions'
import { AddLinkToDocument } from './AddLinkToDocument'

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
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { id } = await params
  // Retour contextuel : si on vient d'un AO (?from=/tenders/...), on y revient.
  // Validé interne (commence par "/" mais pas "//") pour éviter tout open-redirect.
  const { from } = await searchParams
  const safeFrom = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null
  const backHref = safeFrom ?? '/documents'
  const backLabel = safeFrom?.startsWith('/tenders/') ? "Retour à l'appel d'offres" : 'Bibliothèque documentaire'

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

  // Rattachements polymorphes résolus en libellés (« Contrat X · Client Y »).
  const docLinks = (await getDocumentLinkLabels([id])).get(id) ?? []
  // Entités rattachables (pour « + rattacher »), chargées en base.
  const [lContracts, lSites, lClients, lTenders, lTeams] = await Promise.all([
    listContracts(), listSites(), listClients(), listTenders(), listTeams(),
  ])
  const linkTargets: Record<string, { id: string; label: string }[]> = {
    contract: lContracts.map((c) => ({ id: c.id, label: c.name })),
    site: lSites.map((s) => ({ id: s.id, label: s.name })),
    client: lClients.map((c) => ({ id: c.id, label: c.name })),
    tender: lTenders.map((t) => ({ id: t.id, label: t.title })),
    team: lTeams.map((t) => ({ id: t.id, label: t.name })),
  }
  const TARGET_LABEL: Record<string, string> = {
    contract: 'Contrat', site: 'Site', client: 'Client', tender: 'AO', team: 'Équipe',
  }
  const TIER_LABEL: Record<string, string> = {
    vivante: 'Vivante', consultable: 'Consultable', froide: 'Froide',
  }

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

  // Coût IA indicatif = moyenne observée des dernières analyses de document
  // (responsabilise avant « Réanalyser »). Réel, pas théorique.
  const docAvgCost = await getAverageCostForFeatures(['embed_chunks_document'])

  // Temps mémoriel (Sprint D) + supersession VISIBLE : une mémoire qui en
  // remplace une autre ne doit jamais disparaître en silence.
  const memState = memoryState({ status: doc.status, expiresAt: doc.expires_date })
  const [supersededByRes, supersedesRes] = await Promise.all([
    admin.from('documents').select('id, filename').eq('supersedes_document_id', doc.id).is('deleted_at', null).maybeSingle(),
    doc.supersedes_document_id
      ? admin.from('documents').select('id, filename').eq('id', doc.supersedes_document_id).is('deleted_at', null).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const supersededBy = supersededByRes.data as { id: string; filename: string } | null
  const supersedes = (supersedesRes.data ?? null) as { id: string; filename: string } | null

  return (
    <div className="space-y-6 max-w-4xl">
      <Link
        href={backHref}
        className="group inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 h-8 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted active:scale-[0.97] motion-safe:transition-transform"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        {backLabel}
      </Link>

      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold break-words">{doc.filename}</h1>
          <p className="text-sm text-muted-foreground">
            {doc.document_type} · {ANALYSIS_LABEL[doc.analysis_status] ?? doc.analysis_status}
            {doc.analysis_status === 'failed' && doc.failed_reason
              ? ` — ${doc.failed_reason}`
              : ''}
          </p>
        </div>
        {(role === 'admin' || role === 'manager') && (
          <DocumentActions
            documentId={doc.id}
            analysisStatus={doc.analysis_status}
            avgCostUsd={docAvgCost.avgUsd}
            costSampleCount={docAvgCost.count}
          />
        )}
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
            <dt className="text-xs text-muted-foreground">Temps mémoriel</dt>
            <dd className="font-medium" title={memState ? MEMORY_STATE_MEANING[memState] : undefined}>
              {memState ? MEMORY_STATE_LABEL[memState] : doc.status}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Couche mémoire</dt>
            <dd className="font-medium">{doc.memory_tier ? (TIER_LABEL[doc.memory_tier] ?? doc.memory_tier) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Indexation</dt>
            <dd className="font-medium">{indexationState(doc.analysis_status, doc.memory_tier).label}</dd>
          </div>
          <div className="col-span-2 md:col-span-3">
            <dt className="text-xs text-muted-foreground">Rattaché à</dt>
            <dd className="font-medium">
              {docLinks.length === 0 ? (
                <span className="text-muted-foreground italic font-normal">aucun rattachement</span>
              ) : (
                docLinks.map((l) => `${TARGET_LABEL[l.type] ?? l.type} ${l.label}`).join(' · ')
              )}
            </dd>
            {(role === 'admin' || role === 'manager') && (
              <div className="mt-2">
                <AddLinkToDocument documentId={doc.id} linkTargets={linkTargets} />
              </div>
            )}
          </div>
          {(supersededBy || supersedes) && (
            <div className="col-span-2 md:col-span-3">
              <dt className="text-xs text-muted-foreground">Continuité documentaire</dt>
              <dd className="font-medium space-y-0.5">
                {supersededBy && (
                  <p className="text-sm">
                    Remplacé par{' '}
                    <Link href={`/documents/${supersededBy.id}`} className="underline hover:text-foreground">
                      {supersededBy.filename}
                    </Link>
                  </p>
                )}
                {supersedes && (
                  <p className="text-sm text-muted-foreground">
                    Remplace{' '}
                    <Link href={`/documents/${supersedes.id}`} className="underline hover:text-foreground">
                      {supersedes.filename}
                    </Link>
                  </p>
                )}
              </dd>
            </div>
          )}
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
