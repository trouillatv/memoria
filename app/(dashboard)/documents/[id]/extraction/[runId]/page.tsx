import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserRoleById } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getDocument } from '@/lib/db/documents'
import { getExtractionRun, listExtractionForReview, listOrphanEvidenceForRun, listCandidateLinksForRun, getIllustratesLinksForRun } from '@/lib/db/document-extractions'
import { computeReviewSummary } from '@/lib/documents/effective-proposal'
import { getExistingMaterializedVisit } from '@/lib/db/historical-visit-materialization'
import { listSuggestionsForReview } from '@/lib/db/subject-suggestions'
import { ExtractionReviewClient } from './ExtractionReviewClient'

const SIGNED_URL_TTL = 300

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: 'En attente', processing: 'En cours', ready_for_review: 'Prêt pour revue',
  partially_materialized: 'Partiellement matérialisé', materialized: 'Matérialisé', failed: 'Échec',
}

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

export default async function ExtractionReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { id: documentId, runId } = await params
  const sp = await searchParams

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') notFound()

  const doc = await getDocument(documentId)
  if (!doc) notFound()

  // Isolation organisation
  if (role !== 'admin') {
    const orgIds = await getOrgIdsOfUser()
    if (!doc.organization_id || !orgIds.includes(doc.organization_id)) notFound()
  }

  // Run — vérifie qu'il appartient au document
  const run = await getExtractionRun(runId)
  if (!run || run.document_id !== documentId) notFound()

  // Si le run n'est pas encore prêt, affichage simplifié
  if (run.status === 'processing' || run.status === 'pending') {
    return (
      <div className="space-y-4 w-full">
        <Link href={`/documents/${documentId}`} className="group inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 h-8 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Retour au document
        </Link>
        <p className="text-sm text-muted-foreground">
          Analyse en cours — revenez dans quelques instants.
        </p>
      </div>
    )
  }

  if (run.status === 'failed') {
    return (
      <div className="space-y-4 w-full">
        <Link href={`/documents/${documentId}`} className="group inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 h-8 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Retour au document
        </Link>
        <div className="rounded-[18px] border bg-card p-4 space-y-1">
          <p className="font-medium text-destructive">L'analyse a échoué</p>
          {run.error_message && (
            <p className="text-sm text-muted-foreground">{run.error_message}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Retournez au document pour relancer l'extraction.
          </p>
        </div>
      </div>
    )
  }

  // Charger les données de revue + visite déjà matérialisée (idempotence)
  const admin = createAdminClient()
  const [proposalsWithEvidence, orphanEvidenceRaw, alreadySiteReportId, candidateLinks, illustratesLinks, subjectSuggestions] = await Promise.all([
    listExtractionForReview(runId),
    listOrphanEvidenceForRun(runId),
    getExistingMaterializedVisit(runId),
    listCandidateLinksForRun(runId),
    getIllustratesLinksForRun(runId),
    listSuggestionsForReview(runId, run.target_site_id ?? null),
  ])

  // Normalisation idempotente : pour chaque page ayant des images natives,
  // transférer le pin du snapshot vers les images (snapshot ne doit jamais être
  // épinglé quand des images existent sur la même page).
  let orphanEvidence = orphanEvidenceRaw
  {
    const { data: allVisual } = await admin
      .from('document_extraction_evidence')
      .select('id, source_page, evidence_type, pinned_for_visit')
      .eq('extraction_run_id', runId)
      .in('evidence_type', ['page_snapshot', 'image'])

    if (allVisual?.length) {
      const pagesWithAnyImg = new Set(allVisual.filter((e) => e.evidence_type === 'image').map((e) => e.source_page))
      const pagesWithPinnedSnap = new Set(
        allVisual.filter((e) => e.evidence_type === 'page_snapshot' && e.pinned_for_visit && pagesWithAnyImg.has(e.source_page)).map((e) => e.source_page),
      )
      const toPin   = allVisual.filter((e) => e.evidence_type === 'image'         && !e.pinned_for_visit && pagesWithPinnedSnap.has(e.source_page)).map((e) => e.id)
      const toUnpin = allVisual.filter((e) => e.evidence_type === 'page_snapshot' &&  e.pinned_for_visit && pagesWithAnyImg.has(e.source_page)).map((e) => e.id)

      if (toPin.length > 0 || toUnpin.length > 0) {
        if (toPin.length > 0)   await admin.from('document_extraction_evidence').update({ pinned_for_visit: true  }).in('id', toPin)
        if (toUnpin.length > 0) await admin.from('document_extraction_evidence').update({ pinned_for_visit: false }).in('id', toUnpin)
        orphanEvidence = await listOrphanEvidenceForRun(runId)
      }
    }
  }

  // Générer des URLs signées pour toutes les preuves avec storage_path
  const evidenceMap = new Map<string, string>() // evidenceId → storage_path

  for (const pw of proposalsWithEvidence) {
    for (const ev of pw.evidence) {
      if (ev.evidence.storage_path) evidenceMap.set(ev.evidence.id, ev.evidence.storage_path)
    }
  }
  for (const ev of orphanEvidence) {
    if (ev.storage_path) evidenceMap.set(ev.id, ev.storage_path)
  }
  for (const link of illustratesLinks) {
    if (link.storage_path) evidenceMap.set(link.evidence_id, link.storage_path)
  }

  const signedUrls: Record<string, string> = {}
  if (evidenceMap.size > 0) {
    const uniquePaths = [...new Set(evidenceMap.values())]
    const pathToUrl = new Map<string, string>()
    const { data: signed } = await admin.storage.from('documents').createSignedUrls(uniquePaths, SIGNED_URL_TTL)
    if (signed) {
      for (const s of signed) {
        if (s.signedUrl && s.path) pathToUrl.set(s.path, s.signedUrl)
      }
    }
    for (const [evidenceId, path] of evidenceMap) {
      const url = pathToUrl.get(path)
      if (url) signedUrls[evidenceId] = url
    }
  }

  const allProposals = proposalsWithEvidence.map((p) => p.proposal)
  const summary = computeReviewSummary(allProposals)

  return (
    <div className="space-y-6 w-full">
      <Link
        href={`/documents/${documentId}`}
        className="group inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 h-8 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted active:scale-[0.97] motion-safe:transition-transform"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        Retour au document
      </Link>

      {/* En-tête */}
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Analyse du PV historique</h1>
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p className="break-words">{doc.filename}</p>
          {doc.effective_date && <p>Date du PV : {frDate(doc.effective_date)}</p>}
          <p>Statut : <span className="font-medium text-foreground">{RUN_STATUS_LABEL[run.status] ?? run.status}</span></p>
          <p className="text-xs">
            {run.extractor_key} · Exécuté le {frDate(run.created_at)}
          </p>
        </div>
      </header>

      {/* Corps */}
      <ExtractionReviewClient
        proposals={proposalsWithEvidence}
        orphanEvidence={orphanEvidence}
        signedUrls={signedUrls}
        documentId={documentId}
        runId={runId}
        summary={summary}
        effectiveDate={doc.effective_date ?? null}
        targetSiteId={run.target_site_id ?? null}
        alreadySiteReportId={alreadySiteReportId}
        candidateLinks={candidateLinks}
        initialIllustratesLinks={illustratesLinks}
        initialStatus={sp.status ?? null}
        initialType={sp.type ?? null}
        subjectSuggestions={subjectSuggestions}
      />
    </div>
  )
}
