// LA PAGE D'UNE VISITE — un bureau de traitement, pas un rapport.
//
// Il existait deux pages pour une même visite : un « Débrief de chantier » resté
// au monde d'avant le compte-rendu documentaire, et le récit. Deux portes vers
// le même objet suffisaient à rendre le produit illisible. Cette adresse EST la
// visite, et la seule.
//
// « Une page ne doit proposer que les gestes cohérents avec son récit. » Sur une
// visite : écouter, comprendre, raconter, arbitrer, concrétiser. Créer une
// action ex nihilo n'appartient pas à cette histoire — cela rouvrirait une
// deuxième porte vers un objet que la concrétisation fabrique déjà, avec sa
// provenance.
//
// L'ORDRE EST CELUI DE LA LECTURE, PAS CELUI DU PIPELINE : ce qui s'est passé,
// ce que MemorIA en a compris, ce qui attend une décision. L'audit — ignoré,
// obsolète — descend en bas, à un clic.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, CheckCheck, CheckCircle2, ChevronRight, FileDown, FileText, Home, Images, Pencil,
  Sparkles, Users,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { getIllustratesLinksForRun } from '@/lib/db/document-extractions'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { VisitShareButton } from '@/app/(field)/m/visite/[reportId]/VisitShareButton'
import { VisitDesk, type CaptureMedia } from './VisitDesk'
import { ReanalyseButton } from './ReanalyseButton'
import { VerserPiece } from './VerserPiece'
import { RegenerateNarrativeButton } from './RegenerateNarrativeButton'

export const dynamic = 'force-dynamic'

/** Les familles d'arbitrage — la MÊME teinte que dans le bureau, d'un bout à
 *  l'autre de la page : c'est ce qui permet de retrouver « les échéances » sans
 *  lire les mots. */
const FAMILLES: Array<{ cle: string; un: string; plusieurs: string; teinte: string }> = [
  { cle: 'action', un: 'action', plusieurs: 'actions', teinte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  { cle: 'deadline', un: 'échéance', plusieurs: 'échéances', teinte: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  { cle: 'stakeholder', un: 'intervenant', plusieurs: 'intervenants', teinte: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { cle: 'knowledge', un: 'connaissance', plusieurs: 'connaissances', teinte: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' },
  { cle: 'vigilance', un: 'vigilance', plusieurs: 'vigilances', teinte: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
  { cle: 'decision', un: 'décision', plusieurs: 'décisions', teinte: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' },
]

export default async function VisitPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit, narrative, doc] = await Promise.all([
    getSiteIdentity(id),
    getVisit(visitId),
    buildVisitNarrative(visitId),
    getVisitCrDocument(visitId).catch(() => null),
  ])
  if (!identity || !visit || visit.site_id !== id || !narrative) notFound()
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const [media, conducteur] = await Promise.all([
    getVisitCapturePreviewUrls(
      narrative.captured
        .filter((c) => c.attachmentId)
        .map((c) => ({ id: c.id, attachment_id: c.attachmentId }) as VisitCaptureRow),
    ).catch((): CaptureMedia => ({})),
    resolveConducteur(visit.created_by ?? null),
  ])

  // Le résumé affiché est celui du compte-rendu HUMAIN — jamais un second texte
  // fabriqué pour l'en-tête.
  const resume = doc?.sections.find((s) => s.key === 'resume')?.content?.trim() || null
  // LE COMPTE-RENDU RESTE DANS LE BUREAU. Il n'existait qu'à l'adresse mobile :
  // « Arbitrer » éjectait donc le conducteur dans la coquille téléphone pour
  // faire le travail de la visite. Même moteur, surface desktop.
  const crHref = doc ? `/sites/${id}/visites/${visitId}/compte-rendu` : null

  const debut = visit.started_at ?? visit.created_at
  const minutes = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null

  const { captured, understood, produced, historical, enrichment } = narrative
  const isImport = visit.origin === 'import'

  // Photos depuis le PV — calculées avant photos pour alimenter le compteur
  type PinnedSnapshot = { id: string; page: number | null; caption: string | null; url: string }
  const pinnedSnapshots: PinnedSnapshot[] = []
  let totalSnapshotCount = 0
  let extractionDocumentId: string | null = null
  let extractionTotalProposals = 0
  let extractionIntervenantCount = 0
  let extractionPersonCount = 0
  let extractionCompanyCount = 0
  let historicalSummary: string | null = null
  type ExtPersonProp = { name: string; status: string | null; description: string | null; linkedCompanyName: string | null }
  const extractionPersonProps: ExtPersonProp[] = []
  type ChronologieItem = { label: string; page: number | null; proposalId: string; photos: Array<{ evidenceId: string; caption: string | null; url: string }> }
  let chronologieItems: ChronologieItem[] = []
  let illustratedSnapshotIds = new Set<string>()
  const runId = isImport ? (visit.extraction_run_id ?? null) : null
  if (runId) {
    const admin = createAdminClient()
    const [pinnedResult, countResult, runResult, totalPropsResult, personPropsResult, visitExtraResult, chronoResult, illustratesResult] = await Promise.all([
      admin
        .from('document_extraction_evidence')
        .select('id, source_page, caption, storage_path, evidence_type')
        .eq('extraction_run_id', runId)
        .eq('pinned_for_visit', true)
        .in('evidence_type', ['page_snapshot', 'image']),
      admin
        .from('document_extraction_evidence')
        .select('source_page, evidence_type')
        .eq('extraction_run_id', runId)
        .in('evidence_type', ['page_snapshot', 'image']),
      admin
        .from('document_extraction_run')
        .select('document_id')
        .eq('id', runId)
        .maybeSingle(),
      admin
        .from('document_extraction_proposal')
        .select('id', { count: 'exact', head: true })
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited', 'materialized']),
      admin
        .from('document_extraction_proposal')
        .select('label, reviewed_label, proposal_family, source_payload, description')
        .eq('extraction_run_id', runId)
        .in('review_status', ['accepted', 'edited', 'materialized'])
        .in('proposal_family', ['person', 'company']),
      admin
        .from('site_reports')
        .select('debrief_analysis')
        .eq('id', visitId)
        .maybeSingle(),
      admin
        .from('document_extraction_proposal')
        .select('id, label, reviewed_label, source_page')
        .eq('extraction_run_id', runId)
        .eq('proposal_family', 'knowledge_fact')
        .in('review_status', ['accepted', 'edited', 'materialized'])
        .filter('source_payload->>statusAtDocumentDate', 'eq', 'réalisé'),
      getIllustratesLinksForRun(runId).catch(() => []),
    ])
    // Déduplication : une page avec images natives ne compte pas son snapshot.
    const rawVisual = (countResult.data ?? []) as Array<{ source_page: number | null; evidence_type: string }>
    const pagesWithAnyImg = new Set(rawVisual.filter((e) => e.evidence_type === 'image').map((e) => e.source_page))
    totalSnapshotCount = rawVisual.filter((e) => e.evidence_type === 'image' || !pagesWithAnyImg.has(e.source_page)).length
    extractionDocumentId = (runResult.data as { document_id: string } | null)?.document_id ?? null
    extractionTotalProposals = totalPropsResult.count ?? 0
    const rawSummary = (visitExtraResult.data as { debrief_analysis?: Record<string, unknown> } | null)?.debrief_analysis?.historical_summary
    historicalSummary = typeof rawSummary === 'string'
      ? rawSummary
      : (rawSummary as { text?: string } | null)?.text ?? null
    const intProps = (personPropsResult.data ?? []) as Array<{ label: string; reviewed_label: string | null; proposal_family: string; source_payload: { statusAtDocumentDate?: string; linkedCompanyName?: string } | null; description: string | null }>
    extractionIntervenantCount = intProps.length
    extractionPersonCount = intProps.filter((p) => p.proposal_family === 'person').length
    extractionCompanyCount = intProps.filter((p) => p.proposal_family === 'company').length
    for (const p of intProps) {
      if (p.proposal_family === 'person') {
        extractionPersonProps.push({
          name: p.reviewed_label ?? p.label,
          status: p.source_payload?.statusAtDocumentDate ?? null,
          description: p.description ?? null,
          linkedCompanyName: p.source_payload?.linkedCompanyName ?? null,
        })
      }
    }
    // Build illustratesMap: proposalId → [{evidenceId, caption, storagePath}]
    type IllustratesLink = { proposal_id: string; evidence_id: string; caption: string | null; storage_path: string | null; source_page: number | null }
    const illustratesLinks = (illustratesResult ?? []) as IllustratesLink[]
    const illustratesMap = new Map<string, Array<{ evidenceId: string; caption: string | null; storagePath: string | null }>>()
    for (const link of illustratesLinks) {
      const arr = illustratesMap.get(link.proposal_id) ?? []
      arr.push({ evidenceId: link.evidence_id, caption: link.caption, storagePath: link.storage_path })
      illustratesMap.set(link.proposal_id, arr)
    }
    illustratedSnapshotIds = new Set(illustratesLinks.map((l) => l.evidence_id))

    // Sign all paths in one batch (pinned snapshots + illustrates photos)
    // Règle de priorité : si une page a des images natives épinglées, le snapshot
    // de cette page est exclu — il ne sert que de fallback pour les pages sans images.
    const allPinnedVisual = (pinnedResult.data ?? []) as Array<{ id: string; source_page: number | null; caption: string | null; storage_path: string | null; evidence_type: string }>
    const pagesWithPinnedImages = new Set(allPinnedVisual.filter((e) => e.evidence_type === 'image').map((e) => e.source_page))
    const pinnedRows = allPinnedVisual.filter((e) => e.evidence_type === 'image' || !pagesWithPinnedImages.has(e.source_page))
    const allPaths = [...new Set([
      ...pinnedRows.map((e) => e.storage_path).filter((p): p is string => !!p),
      ...illustratesLinks.map((l) => l.storage_path).filter((p): p is string => !!p),
    ])]
    let urlByPath = new Map<string, string>()
    if (allPaths.length > 0) {
      const { data: signed } = await admin.storage.from('documents').createSignedUrls(allPaths, 3600)
      urlByPath = new Map(
        ((signed ?? []) as Array<{ path: string | null; signedUrl: string }>)
          .filter((s) => s.path && s.signedUrl)
          .map((s) => [s.path as string, s.signedUrl]),
      )
    }

    for (const e of pinnedRows) {
      if (!e.storage_path) continue
      const url = urlByPath.get(e.storage_path)
      if (url) pinnedSnapshots.push({ id: e.id, page: e.source_page, caption: e.caption, url })
    }

    chronologieItems = ((chronoResult.data ?? []) as Array<{ id: string; label: string; reviewed_label: string | null; source_page: number | null }>)
      .sort((a, b) => (a.source_page ?? 9999) - (b.source_page ?? 9999))
      .map((p) => {
        const photos = (illustratesMap.get(p.id) ?? [])
          .map((ill) => {
            const url = ill.storagePath ? urlByPath.get(ill.storagePath) : undefined
            return url ? { evidenceId: ill.evidenceId, caption: ill.caption, url } : null
          })
          .filter((x): x is { evidenceId: string; caption: string | null; url: string } => x !== null)
        return { label: p.reviewed_label ?? p.label, page: p.source_page, proposalId: p.id, photos }
      })
  }
  const extractionReviewHref = extractionDocumentId && runId
    ? `/documents/${extractionDocumentId}/extraction/${runId}`
    : null
  const unlinkedPinnedSnapshots = pinnedSnapshots.filter((s) => !illustratedSnapshotIds.has(s.id))

  const vocaux = captured.filter((c) => c.kind === 'vocal').length
  const photos = captured.filter((c) => c.kind === 'photo').length + (isImport ? pinnedSnapshots.length : 0)
  const videos = captured.filter((c) => c.kind === 'video').length
  const intervenants = understood.filter((p) => p.type === 'stakeholder').length
  const enAttente = understood.filter((p) => p.status === 'proposed')
  const parFamille = FAMILLES.map((f) => ({ ...f, n: enAttente.filter((p) => p.type === f.cle).length })).filter((f) => f.n > 0)
  const produitsCount = isImport ? historical.length : produced.length

  // Résumé ventilé pour les visites historiques importées
  const importResumeText = (() => {
    if (!isImport || historical.length === 0) return null
    const PLURALS: Record<string, [string, string]> = {
      action:    ['action', 'actions'],
      reserve:   ['réserve', 'réserves'],
      decision:  ['décision', 'décisions'],
      echeance:  ['échéance', 'échéances'],
      vigilance: ['point de vigilance', 'points de vigilance'],
      memoire:   ['mémoire', 'mémoires'],
    }
    const counts = new Map<string, number>()
    for (const h of historical) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1)
    const parts = [...counts.entries()].map(([kind, n]) => {
      const [s, p] = PLURALS[kind] ?? [kind, `${kind}s`]
      return `${n} ${n > 1 ? p : s}`
    })
    return `Importé depuis un PV : ${parts.join(', ')}.`
  })()

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link href="/sites" className="hover:text-foreground">Chantiers</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <Link href={`/sites/${id}/visites`} className="hover:text-foreground">Visites</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <span className="font-medium text-foreground">
            {isImport && visit.text_input ? visit.text_input : `Visite du ${frDate(debut)}`}
          </span>
        </nav>
        <Link
          href={`/sites/${id}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          Retour au chantier
        </Link>
      </div>

      {/* ── IDENTITÉ ────────────────────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">
            {isImport && visit.text_input ? visit.text_input : `Visite du ${frDate(debut)}`}
          </h1>
          {isImport && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">Visite historique importée</span>
          )}
          <EtatCr crHref={crHref} doc={narrative.validated.document} />
        </div>
        {isImport && (
          <p className="mt-1 text-[13px] text-muted-foreground">{frDate(debut)}</p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="tabular-nums">
            {frHeure(debut)}
            {visit.ended_at ? ` → ${frHeure(visit.ended_at)}` : ''}
            {minutes !== null ? ` (${frDuree(minutes)})` : ''}
          </span>
          {conducteur && (
            <span>
              Par <span className="font-medium text-foreground">{conducteur}</span> · Conducteur de travaux
            </span>
          )}
          {!visit.ended_at && <span>visite en cours</span>}
        </p>
      </header>

      <div className="lg:flex lg:items-start lg:gap-4">
        <div className="min-w-0 flex-1 space-y-4">
          {/* ── ÉTAT DE L'ANALYSE — jamais un numéro de version ─────────────── */}
          <BandeauAnalyse enrichment={enrichment} visitId={visitId} crHref={crHref} isImport={isImport} />

          {/* ── RÉSUMÉ + LES QUATRE CHIFFRES ────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-4 lg:flex lg:gap-6">
            <div className="min-w-0 lg:w-2/5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
                Résumé de la visite
              </h2>
              {resume ? (
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">{resume}</p>
              ) : isImport ? (
                <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-line">
                  {historicalSummary ?? importResumeText ?? "Visite reconstruite depuis un PV historique. Aucun objet détecté."}
                </p>
              ) : (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Aucun compte-rendu n’a encore été rédigé pour cette visite.
                </p>
              )}
              {isImport && runId && (
                <RegenerateNarrativeButton siteReportId={visitId} runId={runId} />
              )}
              {crHref && (
                <Link href={crHref} className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline">
                  Voir le compte-rendu complet ↗
                </Link>
              )}
            </div>
            <dl className="mt-4 grid flex-1 grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              {isImport ? (
                <>
                  <Chiffre icon={Images} teinte="text-sky-600" valeur={pinnedSnapshots.length} label={pinnedSnapshots.length !== 1 ? 'photos importées' : 'photo importée'} sous={totalSnapshotCount > pinnedSnapshots.length ? `/ ${totalSnapshotCount} disponibles` : undefined} />
                  <Chiffre icon={Sparkles} teinte="text-violet-600" valeur={extractionTotalProposals} label="propositions" sous="analysées depuis le PV" />
                  <Chiffre icon={Users} teinte="text-emerald-600" valeur={extractionIntervenantCount} label="acteurs détectés" sous={`${extractionPersonCount} pers. · ${extractionCompanyCount} entr.`} />
                  <Chiffre icon={FileText} teinte="text-slate-600" valeur={produitsCount} label="objets créés" sous="importés depuis le PV" />
                </>
              ) : (
                <>
                  <Chiffre
                    icon={Camera}
                    teinte="text-sky-600"
                    valeur={captured.length}
                    label="captures"
                    sous={[plural(photos, 'photo', 'photos'), plural(vocaux, 'vocal', 'vocaux'), plural(videos, 'vidéo', 'vidéos')]
                      .filter(Boolean)
                      .join(', ')}
                  />
                  <Chiffre icon={Sparkles} teinte="text-violet-600" valeur={understood.length} label="propositions" sous="détectées par MemorIA" />
                  <Chiffre icon={Users} teinte="text-emerald-600" valeur={intervenants} label="intervenants" sous="détectés" />
                  <Chiffre icon={FileText} teinte="text-slate-600" valeur={produitsCount} label="objets produits" sous="rattachés à ce récit" />
                </>
              )}
            </dl>
          </section>

          {isImport && totalSnapshotCount > 0 && (
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <h2 className="text-[15px] font-semibold flex items-center gap-2">
                <Camera className="h-4 w-4 text-sky-600" aria-hidden />
                {illustratedSnapshotIds.size > 0 ? 'Autres photos de la visite' : 'Photos depuis le PV'}
                <span className="text-xs font-normal text-muted-foreground">
                  {unlinkedPinnedSnapshots.length > 0
                    ? `${unlinkedPinnedSnapshots.length} / ${totalSnapshotCount} incluse${unlinkedPinnedSnapshots.length > 1 ? 's' : ''}`
                    : pinnedSnapshots.length > 0
                      ? `${pinnedSnapshots.length} associée${pinnedSnapshots.length > 1 ? 's' : ''} aux constatations`
                      : `${totalSnapshotCount} disponible${totalSnapshotCount > 1 ? 's' : ''}`}
                </span>
              </h2>
              {unlinkedPinnedSnapshots.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  {pinnedSnapshots.length > 0
                    ? 'Toutes les photos sélectionnées sont associées aux constatations ci-dessus.'
                    : `${totalSnapshotCount} page${totalSnapshotCount > 1 ? 's' : ''} photographique${totalSnapshotCount > 1 ? 's' : ''} détectée${totalSnapshotCount > 1 ? 's' : ''} dans le PV — aucune n'a été sélectionnée pour cette fiche.`}
                  {extractionReviewHref && pinnedSnapshots.length === 0 && (
                    <Link href={extractionReviewHref} className="ml-2 text-primary underline underline-offset-2">
                      Sélectionner des photos ↗
                    </Link>
                  )}
                </p>
              ) : (
                <>
                  {extractionReviewHref && unlinkedPinnedSnapshots.length < totalSnapshotCount && (
                    <p className="text-xs text-muted-foreground">
                      {totalSnapshotCount - unlinkedPinnedSnapshots.length} page{totalSnapshotCount - unlinkedPinnedSnapshots.length > 1 ? 's' : ''} non incluse{totalSnapshotCount - unlinkedPinnedSnapshots.length > 1 ? 's' : ''}.{' '}
                      <Link href={extractionReviewHref} className="underline underline-offset-2">
                        Modifier la sélection ↗
                      </Link>
                    </p>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {unlinkedPinnedSnapshots.map((snap) => (
                      <a key={snap.id} href={snap.url} target="_blank" rel="noopener noreferrer" className="block group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={snap.url}
                          alt={snap.caption ?? `Page ${snap.page ?? ''}`}
                          className="w-full rounded border object-contain aspect-video bg-muted group-hover:opacity-90 transition-opacity"
                        />
                        {snap.caption && (
                          <p className="text-[11px] text-muted-foreground mt-1 truncate">{snap.caption}</p>
                        )}
                        {!snap.caption && snap.page !== null && (
                          <p className="text-[11px] text-muted-foreground mt-1">Page {snap.page}</p>
                        )}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {isImport && historical.length > 0 && (() => {
            const GROUP_ORDER: Array<{ kind: string; label: string; labelUn: string }> = [
              { kind: 'action',    label: 'Actions',               labelUn: 'action' },
              { kind: 'echeance',  label: 'Échéances',             labelUn: 'échéance' },
              { kind: 'vigilance', label: 'Points de vigilance',   labelUn: 'point de vigilance' },
              { kind: 'memoire',   label: 'Éléments de mémoire',   labelUn: 'élément de mémoire' },
              { kind: 'reserve',   label: 'Réserves',              labelUn: 'réserve' },
              { kind: 'decision',  label: 'Décisions',             labelUn: 'décision' },
            ]
            const byKind = new Map<string, typeof historical>()
            for (const obj of historical) {
              if (!byKind.has(obj.kind)) byKind.set(obj.kind, [])
              byKind.get(obj.kind)!.push(obj)
            }
            const groups = GROUP_ORDER.filter((g) => byKind.has(g.kind))
            return (
              <section className="rounded-xl border bg-card p-4 space-y-2">
                <h2 className="text-[15px] font-semibold">
                  Objets importés depuis le PV
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{historical.length} au total</span>
                </h2>
                <div className="space-y-1">
                  {groups.map((g) => {
                    const items = byKind.get(g.kind)!
                    return (
                      <details key={g.kind} className="group rounded-lg border bg-muted/20 open:bg-card">
                        <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium list-none [&::-webkit-details-marker]:hidden">
                          <span>{g.label}</span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                            {items.length}
                          </span>
                        </summary>
                        <div className="divide-y border-t px-3 text-[13px]">
                          {items.map((obj) => (
                            <div key={`${obj.kind}-${obj.id}`} className="py-2 text-foreground/90">
                              {obj.label}
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })}
                </div>
              </section>
            )
          })()}

          {isImport && chronologieItems.length > 0 && (
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <h2 className="text-[15px] font-semibold flex items-center gap-2">
                <CheckCheck className="h-4 w-4 text-green-600" aria-hidden />
                Évolution du chantier
                <span className="text-xs font-normal text-muted-foreground">{chronologieItems.length} réalisé{chronologieItems.length > 1 ? 's' : ''}</span>
              </h2>
              <ol className="relative text-[13px]">
                {chronologieItems.map((item, i) => (
                  <li key={i} className="relative flex items-start gap-3 pb-4 last:pb-0">
                    {i < chronologieItems.length - 1 && (
                      <span aria-hidden className="absolute left-[6px] top-[18px] h-[calc(100%-10px)] w-px bg-green-200 dark:bg-green-900/60" />
                    )}
                    <span aria-hidden className="relative mt-0.5 shrink-0 h-3.5 w-3.5 rounded-full border-2 border-green-500 bg-card" />
                    <div className="min-w-0 pt-px">
                      <span>{item.label}</span>
                      {item.photos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.photos.map((photo) => (
                            <a key={photo.evidenceId} href={photo.url} target="_blank" rel="noopener noreferrer" className="block shrink-0 group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photo.url}
                                alt={photo.caption ?? 'Photo'}
                                title={photo.caption ?? undefined}
                                className="h-16 w-24 rounded border object-cover bg-muted group-hover:opacity-90 transition-opacity"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {isImport && extractionPersonProps.length > 0 && (
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <h2 className="text-[15px] font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-600" aria-hidden />
                Présences à cette visite
              </h2>
              <div className="divide-y text-[13px]">
                {extractionPersonProps.map((p, idx) => (
                  <div key={idx} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{p.name}</p>
                      {(p.description || p.linkedCompanyName) && (
                        <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">
                          {p.description ?? p.linkedCompanyName}
                        </p>
                      )}
                    </div>
                    <AttendanceBadge status={p.status} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <VisitDesk narrative={narrative} media={media} canPromote={doc?.status === 'draft'} crHref={crHref} />
        </div>

        {/* ── RAIL — les gestes, l'arbitrage, le vocabulaire ─────────────────── */}
        <aside className="mt-4 space-y-4 lg:mt-0 lg:w-80 lg:shrink-0">
          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-[13px] font-semibold">Actions sur cette visite</h2>
            <VisitShareButton reportId={visitId} siteName={identity.name} pdfUrl={`/sites/${id}/visites/${visitId}/pdf`} />
            <div className="mt-1 divide-y">
              {enrichment.sinceLastAnalysis > 0 && (
                <div className="py-1.5">
                  <ReanalyseButton reportId={visitId} />
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {enrichment.sinceLastAnalysis} pièce{enrichment.sinceLastAnalysis > 1 ? 's versées' : ' versée'} depuis l’analyse
                  </p>
                </div>
              )}
              <div className="py-1.5">
                <VerserPiece reportId={visitId} visitStartedAt={debut} />
                <p className="pl-8 text-[11.5px] text-muted-foreground">Photo, vocal, vidéo</p>
              </div>
              <RailLink href={`/sites/${id}/visites/${visitId}/pdf`} icon={<FileDown className="h-4 w-4" aria-hidden />} label="Télécharger le compte-rendu" sous="PDF" newTab />
              <RailLink href={`/m/visite/${visitId}/recap`} icon={<Images className="h-4 w-4" aria-hidden />} label="Ouvrir sur mobile" />
            </div>
          </section>

          {/* ── ARBITRAGES — le vrai travail, chiffré par famille ───────────── */}
          {enAttente.length > 0 && (
            <section className="rounded-xl border bg-card p-3">
              <h2 className="text-[13px] font-semibold">Arbitrages</h2>
              <p className="mt-1 text-[13px] font-medium">
                {enAttente.length} décision{enAttente.length > 1 ? 's vous attendent' : ' vous attend'}
              </p>
              <ul className="mt-2 space-y-1.5">
                {parFamille.map((f) => (
                  <li key={f.cle} className="flex items-center gap-2 text-[13px]">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold tabular-nums ${f.teinte}`}>
                      {f.n}
                    </span>
                    {f.n > 1 ? f.plusieurs : f.un}
                  </li>
                ))}
              </ul>
              {crHref && (
                <Link
                  href={crHref}
                  className="mt-3 block rounded-lg bg-primary px-3 py-2 text-center text-[13px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Relire et arbitrer
                </Link>
              )}
            </section>
          )}

          {/* ── COMPRENDRE LES STATUTS — chaque mot de cette page a un sens ─── */}
          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-[13px] font-semibold">Comprendre les statuts</h2>
            <dl className="space-y-2.5">
              <Statut mot="En attente" teinte="bg-sky-500" sens="Proposition de MemorIA à arbitrer." />
              <Statut mot="Confirmée" teinte="bg-emerald-500" sens="Vous l’avez validée. Elle peut être concrétisée." />
              <Statut mot="Écartée" teinte="bg-rose-500" sens="Vous l’avez refusée. Elle n’apparaîtra plus." />
              <Statut mot="Obsolète" teinte="bg-amber-500" sens="Devenue dépassée après une nouvelle analyse — ce n’est pas un refus." />
              <Statut mot="Ajoutée après" teinte="bg-slate-400" sens="Pièce versée au dossier après la visite." />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** L'état du compte-rendu, en une pastille : puis-je encore l'enrichir ? */
function EtatCr({ crHref, doc }: { crHref: string | null; doc: { status: string; validatedAt: string | null } | null }) {
  if (!doc || !crHref) {
    return (
      <span className="rounded-full border border-dashed px-2.5 py-1 text-[12.5px] text-muted-foreground">
        Aucun compte-rendu
      </span>
    )
  }
  const brouillon = doc.status === 'draft'
  return (
    <Link
      href={crHref}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
        brouillon
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
      }`}
    >
      {brouillon ? 'Compte-rendu en brouillon' : `Compte-rendu finalisé${doc.validatedAt ? ` le ${frDate(doc.validatedAt)}` : ''}`}
      <Pencil className="h-3 w-3" aria-hidden />
    </Link>
  )
}

/** Trois états, et AUCUN numéro de version : `analysis_version` mesure la
 *  dernière analyse ayant RECONDUIT une proposition, pas sa naissance.
 *  Numéroter les analyses compterait comme neuve une proposition née à la
 *  première et simplement redite (tranché 2026-07-22). */
function BandeauAnalyse({
  enrichment,
  visitId,
  crHref,
  isImport,
}: {
  enrichment: { afterVisit: number; sinceLastAnalysis: number; lastAnalysisAt: string | null }
  visitId: string
  crHref: string | null
  isImport?: boolean
}) {
  if (!enrichment.lastAnalysisAt) {
    return (
      <section className="rounded-xl border border-dashed px-4 py-3 text-[13px] text-muted-foreground">
        {isImport
          ? "Visite historique — importée depuis un PV, aucune analyse IA sur place."
          : "Cette visite n’a pas encore été lue par MemorIA."}
      </section>
    )
  }
  const aJour = enrichment.sinceLastAnalysis === 0
  return (
    <section
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
        aJour
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
          : 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
      }`}
    >
      <CheckCircle2 className={`h-5 w-5 shrink-0 ${aJour ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{aJour ? 'Analyse MemorIA à jour' : 'Analyse MemorIA dépassée'}</p>
        <p className="text-[12.5px] text-muted-foreground">
          {aJour
            ? 'Aucune nouvelle pièce depuis la dernière analyse.'
            : `${enrichment.sinceLastAnalysis} pièce${enrichment.sinceLastAnalysis > 1 ? 's ont été versées' : ' a été versée'} depuis la dernière analyse.`}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          Dernière analyse le {frDateHeure(enrichment.lastAnalysisAt)}
        </span>
        {aJour
          ? crHref && (
            <Link href={crHref} className="rounded-lg border bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-muted">
              Voir le détail
            </Link>
          )
          : <ReanalyseButton reportId={visitId} />}
      </div>
    </section>
  )
}

function Chiffre({
  icon: Icon,
  teinte,
  valeur,
  label,
  sous,
}: {
  icon: typeof Camera
  teinte: string
  valeur: number
  label: string
  sous?: string
}) {
  return (
    <div>
      <Icon className={`h-4 w-4 ${teinte}`} aria-hidden />
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{valeur}</dd>
      <dt className="text-[12.5px] leading-snug">{label}</dt>
      {sous && <p className="text-[11.5px] leading-snug text-muted-foreground">{sous}</p>}
    </div>
  )
}

function RailLink({
  href, icon, label, sous, newTab,
}: { href: string; icon: React.ReactNode; label: string; sous?: string; newTab?: boolean }) {
  return (
    <Link
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
    >
      <span className="mt-0.5">{icon}</span>
      <span>
        {label}
        {sous && <span className="block text-[11.5px] text-muted-foreground">{sous}</span>}
      </span>
    </Link>
  )
}

function Statut({ mot, teinte, sens }: { mot: string; teinte: string; sens: string }) {
  return (
    <div className="flex gap-2">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${teinte}`} />
      <div>
        <dt className="text-[13px] font-medium">{mot}</dt>
        <dd className="text-[12px] leading-snug text-muted-foreground">{sens}</dd>
      </div>
    </div>
  )
}

async function resolveConducteur(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await createAdminClient().from('users').select('full_name').eq('id', userId).maybeSingle()
  return (data as { full_name: string | null } | null)?.full_name?.trim() || null
}

const plural = (n: number, un: string, plusieurs: string) => (n > 0 ? `${n} ${n > 1 ? plusieurs : un}` : '')
// Le rendu serveur tourne en UTC : sans `timeZone`, une capture de 09:15 à
// Nouméa s'affichait 22:15 la veille. Le fuseau de l'organisation est donc
// passé EXPLICITEMENT partout — c'est le meme ecueil que `todayLocalIso`.
const frHeure = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })
const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })
const frDateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const frDuree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`)

function AttendanceBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    'présent':            { label: 'Présent',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
    'invité':             { label: 'Invité',    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
    'absent excusé':      { label: 'Excusé',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
    'absent non excusé':  { label: 'Absent',    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
    'diffusion uniquement': { label: 'Diffusion', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  }
  const entry = status ? map[status.toLowerCase()] : null
  if (!entry) return <span className="text-[11px] text-muted-foreground">–</span>
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${entry.cls}`}>
      {entry.label}
    </span>
  )
}
