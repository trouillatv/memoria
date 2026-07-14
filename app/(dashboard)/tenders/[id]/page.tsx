import { notFound } from 'next/navigation'
import { AlertTriangle, FileX, Compass } from 'lucide-react'
import Link from 'next/link'
import {
  getTender,
  getLatestTenderAnalysis,
  getTenderDocument,
  listTenderDocuments,
  findSimilarTenderMemory,
  getSignedVoiceNoteUrl,
} from '@/lib/db/tenders'
import { TenderPiecesCard, type TenderPieceView } from './TenderPiecesCard'
import { listChatMessages, listConversations } from '@/lib/db/atelier-ia'
import { listAgentAnalyses } from '@/lib/db/agent-analyses'
import { listTenderDocumentSources } from '@/lib/db/tender-document-sources'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { getTenderClientCapital } from '@/lib/db/tender-client-capital'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getDossier, listDossiersLite } from '@/lib/db/dossiers'
import { setTenderDossierAction } from './actions'
import { createAdminClient } from '@/lib/supabase/admin'
import { TenderAnalysisLoader } from './TenderAnalysisLoader'
import { TenderSynthese } from './TenderSynthese'
import { TenderAnalyseDetaillee } from './TenderAnalyseDetaillee'
import { TenderMemoireTechnique } from './TenderMemoireTechnique'
import { AtelierIATab } from './AtelierIATab'
import { CopiloteWorkspace } from './CopiloteWorkspace'
import { TenderSidebar, type TenderView } from './TenderSidebar'
import { TenderResizable } from './TenderResizable'
import { buildActivityFeed } from './activity-feed'
import { EvidencePanel } from './EvidencePanel'
import { OutcomeTrigger } from './OutcomeDialog'
import { TenderMemoryPanel } from './TenderMemoryPanel'
import { VoiceNoteRecorder } from './VoiceNoteRecorder'
import { Suspense } from 'react'
import { TerrainMatchingSection, TerrainMatchingSkeleton } from './TerrainMatchingSection'
import { TenderDocumentSourcesSection } from './TenderDocumentSourcesSection'
import { TenderClientCapitalCard } from './TenderClientCapitalCard'

const VALID_VIEWS: TenderView[] = ['synthese', 'analyse', 'memoire', 'atelier']

export default async function TenderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view: viewParam } = await searchParams

  const tender = await getTender(id)
  if (!tender) notFound()

  // Soudure AVANT : l'opportunité (dossier) à laquelle l'AO est rattaché, ou le
  // sélecteur pour l'y rattacher. L'AO est un épisode ; la mémoire vit dans le dossier.
  const attachedDossier = tender.dossier_id ? await getDossier(tender.dossier_id) : null
  const dossiersForPicker = attachedDossier ? [] : await listDossiersLite().catch(() => [])

  const isInProgress =
    tender.status === 'analyzing' || tender.status === 'extracting'
  const isFailed = tender.status === 'failed'
  const isReady =
    tender.status === 'ready' ||
    tender.status === 'submitted' ||
    tender.status === 'archived'

  // Utilisateur courant — utilisé pour resolver les sources documentaires
  // dans le respect de la visibility (canViewDocument).
  const currentUser = await getCurrentUserWithProfile()

  // AO-1 L4 (Vincent 2026-05-21) — capital client (factuel, sans score).
  const clientCapital = await getTenderClientCapital(tender.client_name)

  // L'atelier IA est accessible même pendant une relance (isInProgress) :
  // on charge toujours les messages, analyses agents et conversations.
  const [analysis, doc, chatMessages, agentAnalyses, conversations, documentSources] = isReady || isFailed || isInProgress
    ? await Promise.all([
        getLatestTenderAnalysis(id),
        getTenderDocument(id),
        listChatMessages(id),
        listAgentAnalyses(id),
        listConversations(id),
        listTenderDocumentSources(id, currentUser?.role ?? null),
      ])
    : [null, null, [], [], [], []]

  const canRelaunch = tender.status === 'ready' || tender.status === 'failed'

  // Le DOSSIER (toutes les pièces), pas le dernier fichier déposé. Chargé
  // toujours : savoir ce qui compose l'AO ne dépend pas de l'état de l'analyse.
  const pieces: TenderPieceView[] = (await listTenderDocuments(id).catch(() => [])).map((d) => ({
    id: d.id,
    filename: d.filename,
    kind: d.kind,
    sizeBytes: d.size_bytes,
    read: !!d.extracted_text && d.extracted_text.trim().length > 0,
    uploadedAt: d.uploaded_at,
  }))
  const canEditPieces = currentUser?.role === 'admin' || currentUser?.role === 'manager'

  // Compteur d'engagements extraits — affiché entre parenthèses dans la sidebar.
  // Seulement quand le lien existe (statut finalisé), pour éviter une requête inutile.
  const engagementsCount = isReady ? (await listEngagementsByTender(id)).length : 0

  // Mémoire commerciale MC-2 — rappel contextuel AO similaires.
  // Affiché uniquement AVANT soumission (le moment où la mémoire sert), et
  // jamais sur l'AO courant lui-même s'il a déjà un outcome (sinon c'est
  // lui qu'on devrait analyser, pas comparer).
  const showMemoryPanel =
    (['draft', 'extracting', 'analyzing', 'ready'] as const).includes(
      tender.status as 'draft' | 'extracting' | 'analyzing' | 'ready',
    ) && tender.outcome === null

  const similarTenders = showMemoryPanel
    ? await findSimilarTenderMemory(tender.id)
    : []

  // MC-4 — voice note DG sur AO finalisé (outcome NOT NULL).
  // Archive personnelle, lecture privée admin/manager.
  const hasFinalOutcome = tender.outcome !== null && tender.outcome !== 'pending'
  const voiceNoteSignedUrl = hasFinalOutcome && tender.voice_note_path
    ? await getSignedVoiceNoteUrl(tender.id)
    : null

  // Generate signed URL for PDF source
  let pdfSignedUrl: string | null = null
  if (doc?.storage_path) {
    const supabase = createAdminClient()
    const { data: signed } = await supabase.storage
      .from('tender-documents')
      .createSignedUrl(doc.storage_path, 3600)
    pdfSignedUrl = signed?.signedUrl ?? null
  }

  // Resolve view from URL param, default to 'synthese' (or 'atelier' si pas d'analyse mais ready)
  const requestedView = (VALID_VIEWS as string[]).includes(viewParam ?? '')
    ? (viewParam as TenderView)
    : 'synthese'
  const hasAnalysis = !!analysis
  // Si l'utilisateur demande une vue qui necessite une analyse mais qu'il n'y en a pas,
  // on retombe sur 'atelier' qui est toujours accessible.
  const view: TenderView =
    requestedView !== 'atelier' && !hasAnalysis ? 'atelier' : requestedView

  // KPIs calculés depuis l'analyse
  const kpis = {
    risksCount: (analysis?.risks ?? []).length,
    risksHighCount: (analysis?.risks ?? []).filter((r: { severity?: string }) => r.severity === 'high').length,
    constraintsCount: (analysis?.constraints ?? []).length,
    constraintsRequiredCount: (analysis?.constraints ?? []).filter((c: { required?: boolean }) => c.required).length,
    checklistCount: (analysis?.checklist ?? []).length,
    chatMessagesCount: chatMessages.length,
  }

  const sources = {
    pdfSignedUrl,
    pdfFilename: doc?.filename ?? null,
    libraryItemsCount: (analysis?.library_snapshot as { items_count?: number } | null)?.items_count ?? 0,
    provider: analysis?.provider ?? null,
    isMock: analysis?.provider === 'mock',
  }

  const activityFeed = buildActivityFeed({
    chatMessages,
    agentAnalyses,
    mainAnalysisCreatedAt: analysis?.created_at ?? null,
  })

  return (
    <TenderResizable
      left={
      <TenderSidebar
        tender={tender}
        currentView={view}
        hasAnalysis={hasAnalysis}
        kpis={kpis}
        sources={sources}
        canRelaunch={canRelaunch}
        isInProgress={isInProgress}
        tenderId={id}
        activityFeed={activityFeed}
        engagementsCount={engagementsCount}
      />
      }
      right={
      <div className={view === 'atelier'
        ? 'min-w-0 h-[calc(100vh-3rem)] flex flex-col'
        : 'space-y-4 min-w-0'
      }>
        {/* H1 main (sauf atelier qui a sa propre UI immersive) */}
        {view !== 'atelier' && (isReady || isFailed) && (
          <header className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="text-2xl font-semibold">
                  {view === 'memoire' && 'Mémoire technique'}
                  {view === 'synthese' && 'Synthèse'}
                  {view === 'analyse' && 'Analyse détaillée'}
                </h1>
                <p className="text-sm text-muted-foreground line-clamp-1">{tender.title}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {/* Soudure AVANT — rattacher l'AO à une affaire (ou y naviguer). */}
                {attachedDossier ? (
                  <div className="flex items-center gap-2 text-xs">
                    <Link href={`/dossiers/${attachedDossier.id}`} className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline">
                      <Compass className="h-3.5 w-3.5" /> {attachedDossier.label ?? 'Affaire'}
                    </Link>
                    <form action={setTenderDossierAction}>
                      <input type="hidden" name="tenderId" value={id} />
                      <input type="hidden" name="dossierId" value="" />
                      <button type="submit" className="text-muted-foreground hover:text-destructive">détacher</button>
                    </form>
                  </div>
                ) : dossiersForPicker.length > 0 ? (
                  <form action={setTenderDossierAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="tenderId" value={id} />
                    <select name="dossierId" required defaultValue="" className="rounded-md border bg-background px-2 py-1 text-xs">
                      <option value="" disabled>Rattacher à une affaire…</option>
                      {dossiersForPicker.map((d) => <option key={d.id} value={d.id}>{d.label ?? d.site_name ?? 'Affaire'}</option>)}
                    </select>
                    <button type="submit" className="rounded-md border px-2 py-1 text-xs hover:bg-muted">Rattacher</button>
                  </form>
                ) : null}

                {/* Doctrine V5 — mémoire commerciale. Visible si l'AO est soumis
                    OU déjà marqué (pour modifier). Jamais en push, jamais d'alerte. */}
                {(tender.status === 'submitted' || tender.outcome !== null) && (
                  <OutcomeTrigger
                    tenderId={id}
                    currentOutcome={tender.outcome}
                    currentReason={tender.outcome_reason}
                    currentTag={tender.outcome_tag}
                  />
                )}
              </div>
            </div>
          </header>
        )}

        {/* Mémoire commerciale MC-2 — rappel AO similaires (avant soumission
            uniquement, et jamais sur la vue atelier immersive). Silence positif
            si zéro match. Doctrine V5 V1+V4 : descriptif passif uniquement. */}
        {view !== 'atelier' && showMemoryPanel && similarTenders.length > 0 && (
          <TenderMemoryPanel similarTenders={similarTenders} />
        )}

        {/* MC-4 — voice note DG sur AO finalisé. Doctrine V5 cas validé :
            archive personnelle, déchargement + mémoire incarnée. Strictement
            restreint à outcome NOT NULL. Jamais sur la vue atelier. */}
        {view !== 'atelier' && hasFinalOutcome && (
          <VoiceNoteRecorder
            tenderId={id}
            existingSignedUrl={voiceNoteSignedUrl}
            existingDurationSeconds={tender.voice_note_duration_seconds}
            existingRecordedAt={tender.voice_note_recorded_at}
          />
        )}

        {/* States — affichées indépendamment de la vue sélectionnée */}
        {isInProgress && <TenderAnalysisLoader id={id} />}

        {/* Le dossier, TOUJOURS visible — surtout quand l'analyse a échoué ou n'a
            pas encore tourné : c'est là qu'on a le plus besoin de savoir quelles
            pièces sont là, lesquelles n'ont pas pu être lues, et pourquoi.
            La cacher derrière une analyse réussie, c'était la cacher au moment
            précis où elle sert. */}
        {view !== 'atelier' && (
          <TenderPiecesCard
            tenderId={id}
            pieces={pieces}
            analysedAt={analysis?.created_at ?? null}
            canEdit={canEditPieces}
          />
        )}

        {isFailed && view !== 'atelier' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-rose-700 font-medium">
              {tender.error_msg === 'scanned_pdf_unsupported' ? (
                <>
                  <FileX className="h-5 w-5" />
                  PDF scanne non supporte
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5" />
                  Erreur lors de l&apos;analyse
                </>
              )}
            </div>
            {tender.error_msg === 'scanned_pdf_unsupported' ? (
              <>
                <p className="text-sm text-rose-800">
                  Ce PDF semble etre un scan (pas de texte extractible). MemorIA ne fait pas d&apos;OCR au MVP.
                </p>
                <p className="text-sm text-rose-800 mt-2">
                  <strong>Solution :</strong> ouvrez le PDF dans Word ou Pages, copiez le texte, recreez un PDF texte, puis re-uploadez via{' '}
                  <Link href="/tenders/new" className="underline font-medium">Nouveau dossier</Link>.
                </p>
              </>
            ) : tender.error_msg === 'analyze_timeout' ? (
              <>
                <p className="text-sm text-rose-800">L&apos;analyse a depasse 10 min sans repondre. Le job a ete marque comme echoue automatiquement.</p>
                <p className="text-sm text-rose-800 mt-2">Cliquez sur &laquo; Relancer &raquo; dans les actions ou contactez l&apos;admin si le probleme persiste.</p>
              </>
            ) : (
              <p className="text-sm text-rose-800">{tender.error_msg ?? 'Erreur inconnue'}</p>
            )}
          </div>
        )}

        {/* Section content — selon view */}
        {/* L'atelier est toujours accessible, même pendant une relance de la synthèse */}
        {view === 'atelier' && (isReady || isFailed || isInProgress) && (
          <CopiloteWorkspace
            tenderId={id}
            initialMessages={chatMessages}
            initialAgentAnalyses={agentAnalyses}
            initialConversations={conversations}
            tenderAnalysis={analysis}
            tenderTitle={tender.title}
          />
        )}

        {(isReady || isFailed) && view !== 'atelier' && (
          <>
            {view === 'synthese' && analysis && (
              <>
                <TenderSynthese
                  tender={tender}
                  analysis={analysis}
                  document={doc}
                  pdfSignedUrl={pdfSignedUrl}
                />
                {/* AO-1 L4 (Vincent 2026-05-21) — capital client sous la
                    synthèse : ce qu'on sait déjà du client. Factuel, pas de
                    score, pas de prédiction. */}
                <TenderClientCapitalCard capital={clientCapital} />
                {/* AO-1 L3 (Vincent 2026-05-21) — sources [doc:id] cliquables
                    sous la synthèse, vers /documents/[id]. */}
                <TenderDocumentSourcesSection sources={documentSources ?? []} tenderId={id} />
              </>
            )}
            {view === 'analyse' && analysis && (
              <>
                <TenderAnalyseDetaillee analysis={analysis} />
                {/* AO-1 L3 (Vincent 2026-05-21) — sources [doc:id] cliquables
                    aussi visibles dans la vue analyse détaillée. */}
                <TenderDocumentSourcesSection sources={documentSources ?? []} tenderId={id} />
              </>
            )}
            {view === 'memoire' && analysis && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="min-w-0 space-y-4">
                  <TenderMemoireTechnique tender={tender} analysis={analysis} />
                  <Suspense fallback={<TerrainMatchingSkeleton />}>
                    <TerrainMatchingSection tenderId={id} analysis={analysis} />
                  </Suspense>
                </div>
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <EvidencePanel
                    tenderId={id}
                    memoireText={analysis.technical_memo}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Edge case : ready mais pas d'analyse */}
        {isReady && !analysis && view !== 'atelier' && (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
            Aucune analyse disponible pour ce dossier de démarrage.
            {canRelaunch && ' Vous pouvez relancer l\'analyse via les actions dans la barre latérale.'}
          </div>
        )}
      </div>
      }
      />
  )
}
