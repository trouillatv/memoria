import { notFound } from 'next/navigation'
import { RefreshCw, AlertTriangle, FileX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getTender, getLatestTenderAnalysis, getTenderDocument } from '@/lib/db/tenders'
import { TenderStatusBadge } from './TenderStatusBadge'
import { TenderScoreBadge } from './TenderScoreBadge'
import { TenderAnalysisLoader } from './TenderAnalysisLoader'
import { TenderSynthese } from './TenderSynthese'
import { TenderAnalyseDetaillee } from './TenderAnalyseDetaillee'
import { TenderMemoireTechnique } from './TenderMemoireTechnique'
import { relaunchAnalysisAction as _relaunchAnalysisAction } from './actions'

async function relaunchAnalysisAction(formData: FormData): Promise<void> {
  'use server'
  await _relaunchAnalysisAction(formData)
}

export default async function TenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tender = await getTender(id)
  if (!tender) notFound()

  const isInProgress =
    tender.status === 'analyzing' || tender.status === 'extracting'
  const isFailed = tender.status === 'failed'
  const isReady =
    tender.status === 'ready' ||
    tender.status === 'submitted' ||
    tender.status === 'archived'

  const [analysis, document] = isReady || isFailed
    ? await Promise.all([
        getLatestTenderAnalysis(id),
        getTenderDocument(id),
      ])
    : [null, null]

  const canRelaunch = tender.status === 'ready' || tender.status === 'failed'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold leading-tight">{tender.title}</h1>
            <TenderStatusBadge status={tender.status} />
            {tender.opportunity_score !== null && (
              <TenderScoreBadge score={tender.opportunity_score} />
            )}
          </div>
          {tender.client_name && (
            <p className="text-sm text-muted-foreground">{tender.client_name}</p>
          )}
        </div>

        {canRelaunch && (
          <form action={relaunchAnalysisAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw className="h-3 w-3 mr-1" />
              Relancer l&apos;analyse
            </Button>
          </form>
        )}
      </div>

      {/* States */}
      {isInProgress && <TenderAnalysisLoader id={id} />}

      {isFailed && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-rose-700 font-medium">
            {tender.error_msg === 'scanned_pdf_unsupported' ? (
              <>
                <FileX className="h-5 w-5" />
                PDF scanné non supporté
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5" />
                Erreur lors de l&apos;analyse
              </>
            )}
          </div>
          <p className="text-sm text-rose-700">
            {tender.error_msg === 'scanned_pdf_unsupported'
              ? "Le document soumis est un PDF scanné (image). L'IA ne peut pas extraire le texte. Veuillez re-soumettre un PDF numérique avec texte sélectionnable."
              : tender.error_msg
              ? tender.error_msg
              : "Une erreur inattendue s'est produite. Vous pouvez relancer l'analyse ci-dessus."}
          </p>
        </div>
      )}

      {/* Onglets — visible si analyse dispo */}
      {isReady && analysis && (
        <Tabs defaultValue="synthese">
          <TabsList>
            <TabsTrigger value="synthese">Synthèse</TabsTrigger>
            <TabsTrigger value="analyse">Analyse détaillée</TabsTrigger>
            <TabsTrigger value="memoire">Mémoire technique</TabsTrigger>
          </TabsList>

          <TabsContent value="synthese" className="mt-4">
            <TenderSynthese
              tender={tender}
              analysis={analysis}
              document={document}
            />
          </TabsContent>

          <TabsContent value="analyse" className="mt-4">
            <TenderAnalyseDetaillee analysis={analysis} />
          </TabsContent>

          <TabsContent value="memoire" className="mt-4">
            <TenderMemoireTechnique tender={tender} analysis={analysis} />
          </TabsContent>
        </Tabs>
      )}

      {/* No analysis yet but status ready (edge case) */}
      {isReady && !analysis && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
          Aucune analyse disponible pour cet appel d&apos;offres.
          {canRelaunch && ' Vous pouvez relancer l’analyse ci-dessus.'}
        </div>
      )}
    </div>
  )
}
