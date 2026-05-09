import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RefreshCw, AlertTriangle, FileX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getTender, getLatestTenderAnalysis, getTenderDocument } from '@/lib/db/tenders'
import { createAdminClient } from '@/lib/supabase/admin'
import { TenderStatusBadge } from './TenderStatusBadge'
import { TenderScoreBadge } from './TenderScoreBadge'
import { TenderAnalysisLoader } from './TenderAnalysisLoader'
import { TenderSynthese } from './TenderSynthese'
import { TenderAnalyseDetaillee } from './TenderAnalyseDetaillee'
import { TenderMemoireTechnique } from './TenderMemoireTechnique'
import { relaunchAnalysisAction as _relaunchAnalysisAction } from './actions'
import { ArchiveTenderButton } from './ArchiveTenderButton'

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

  const [analysis, doc] = isReady || isFailed
    ? await Promise.all([
        getLatestTenderAnalysis(id),
        getTenderDocument(id),
      ])
    : [null, null]

  const canRelaunch = tender.status === 'ready' || tender.status === 'failed'

  // Fix 5: generate signed URL for PDF source
  let pdfSignedUrl: string | null = null
  if (doc?.storage_path) {
    const supabase = createAdminClient()
    const { data: signed } = await supabase.storage
      .from('tender-documents')
      .createSignedUrl(doc.storage_path, 3600)
    pdfSignedUrl = signed?.signedUrl ?? null
  }

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

        {/* Fix 2: only show relaunch button when not analyzing/extracting */}
        <div className="flex items-center gap-2">
          {canRelaunch && (
            <form action={relaunchAnalysisAction}>
              <input type="hidden" name="id" value={id} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={isInProgress}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Relancer l&apos;analyse
              </Button>
            </form>
          )}
          {!isInProgress && tender.status !== 'archived' && (
            <ArchiveTenderButton tenderId={id} />
          )}
        </div>
      </div>

      {/* Fix 7: mock mode banner */}
      {analysis?.provider === 'mock' && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <strong>Analyse de demonstration (mode mock).</strong> Le contenu genere ne reflete PAS le PDF uploade &mdash; c&apos;est un exemple pour valider le flux.
              Pour activer l&apos;IA veritable, basculer la variable d&apos;environnement <code className="font-mono bg-white px-1 rounded">AI_PROVIDER=gemini</code> ou <code className="font-mono bg-white px-1 rounded">anthropic</code>.
            </div>
          </CardContent>
        </Card>
      )}

      {/* States */}
      {isInProgress && <TenderAnalysisLoader id={id} />}

      {/* Fix 6: improved error messages */}
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
                Ce PDF semble etre un scan (pas de texte extractible). NetoIAge ne fait pas d&apos;OCR au MVP.
              </p>
              <p className="text-sm text-rose-800 mt-2">
                <strong>Solution :</strong> ouvrez le PDF dans Word ou Pages, copiez le texte, recreez un PDF texte, puis re-uploadez via{' '}
                <Link href="/tenders/new" className="underline font-medium">Nouveau AO</Link>.
              </p>
            </>
          ) : tender.error_msg === 'analyze_timeout' ? (
            <>
              <p className="text-sm text-rose-800">L&apos;analyse a depasse 10 min sans repondre. Le job a ete marque comme echoue automatiquement.</p>
              <p className="text-sm text-rose-800 mt-2">Cliquez sur &laquo; Relancer l&apos;analyse &raquo; ou contactez l&apos;admin si le probleme persiste.</p>
            </>
          ) : (
            <p className="text-sm text-rose-800">{tender.error_msg ?? 'Erreur inconnue'}</p>
          )}
        </div>
      )}

      {/* Onglets - visible si analyse dispo */}
      {isReady && analysis && (
        <Tabs defaultValue="synthese">
          <TabsList>
            <TabsTrigger value="synthese">Synthese</TabsTrigger>
            <TabsTrigger value="analyse">Analyse detaillee</TabsTrigger>
            <TabsTrigger value="memoire">Memoire technique</TabsTrigger>
          </TabsList>

          <TabsContent value="synthese" className="mt-4">
            <TenderSynthese
              tender={tender}
              analysis={analysis}
              document={doc}
              pdfSignedUrl={pdfSignedUrl}
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
          {canRelaunch && ' Vous pouvez relancer l\'analyse ci-dessus.'}
        </div>
      )}
    </div>
  )
}
