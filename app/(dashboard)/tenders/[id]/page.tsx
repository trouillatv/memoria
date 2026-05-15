import { notFound } from 'next/navigation'
import { AlertTriangle, FileX } from 'lucide-react'
import Link from 'next/link'
import {
  getTender,
  getLatestTenderAnalysis,
  getTenderDocument,
  findSimilarTenderMemory,
  getSignedVoiceNoteUrl,
} from '@/lib/db/tenders'
import { listChatMessages } from '@/lib/db/atelier-ia'
import { listAgentAnalyses } from '@/lib/db/agent-analyses'
import { createAdminClient } from '@/lib/supabase/admin'
import { TenderAnalysisLoader } from './TenderAnalysisLoader'
import { TenderSynthese } from './TenderSynthese'
import { TenderAnalyseDetaillee } from './TenderAnalyseDetaillee'
import { TenderMemoireTechnique } from './TenderMemoireTechnique'
import { AtelierIATab } from './AtelierIATab'
import { CopiloteWorkspace } from './CopiloteWorkspace'
import { TenderSidebar, type TenderView } from './TenderSidebar'
import { buildActivityFeed } from './activity-feed'
import { EvidencePanel } from './EvidencePanel'
import { OutcomeTrigger } from './OutcomeDialog'
import { TenderMemoryPanel } from './TenderMemoryPanel'
import { VoiceNoteRecorder } from './VoiceNoteRecorder'

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

  const isInProgress =
    tender.status === 'analyzing' || tender.status === 'extracting'
  const isFailed = tender.status === 'failed'
  const isReady =
    tender.status === 'ready' ||
    tender.status === 'submitted' ||
    tender.status === 'archived'

  const [analysis, doc, chatMessages, agentAnalyses] = isReady || isFailed
    ? await Promise.all([
        getLatestTenderAnalysis(id),
        getTenderDocument(id),
        listChatMessages(id),
        listAgentAnalyses(id),
      ])
    : [null, null, [], []]

  const canRelaunch = tender.status === 'ready' || tender.status === 'failed'

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
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
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
      />

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
              {/* Doctrine V5 — mémoire commerciale. Visible si l'AO est soumis
                  OU déjà marqué (pour modifier). Jamais en push, jamais d'alerte. */}
              {(tender.status === 'submitted' || tender.outcome !== null) && (
                <div className="shrink-0">
                  <OutcomeTrigger
                    tenderId={id}
                    currentOutcome={tender.outcome}
                    currentReason={tender.outcome_reason}
                    currentTag={tender.outcome_tag}
                  />
                </div>
              )}
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

        {isFailed && (
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
                  <Link href="/tenders/new" className="underline font-medium">Nouveau AO</Link>.
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
        {(isReady || isFailed) && (
          <>
            {view === 'synthese' && analysis && (
              <TenderSynthese
                tender={tender}
                analysis={analysis}
                document={doc}
                pdfSignedUrl={pdfSignedUrl}
              />
            )}
            {view === 'analyse' && analysis && (
              <TenderAnalyseDetaillee analysis={analysis} />
            )}
            {view === 'memoire' && analysis && (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="min-w-0">
                  <TenderMemoireTechnique tender={tender} analysis={analysis} />
                </div>
                <div className="lg:sticky lg:top-4 lg:self-start">
                  <EvidencePanel
                    tenderId={id}
                    memoireText={analysis.technical_memo}
                  />
                </div>
              </div>
            )}
            {view === 'atelier' && (
              <CopiloteWorkspace
                tenderId={id}
                initialMessages={chatMessages}
                initialAgentAnalyses={agentAnalyses}
                tenderAnalysis={analysis}
                tenderTitle={tender.title}
              />
            )}
          </>
        )}

        {/* Edge case : ready mais pas d'analyse */}
        {isReady && !analysis && view !== 'atelier' && (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
            Aucune analyse disponible pour cet appel d&apos;offres.
            {canRelaunch && ' Vous pouvez relancer l\'analyse via les actions dans la barre latérale.'}
          </div>
        )}
      </div>
    </div>
  )
}
