import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TenderScoreBadge } from './TenderScoreBadge'
import type { DbTender, DbTenderAnalysis, DbTenderDocument } from '@/types/db'

interface TenderSyntheseProps {
  tender: DbTender
  analysis: DbTenderAnalysis
  document: DbTenderDocument | null
  pdfSignedUrl?: string | null
}

export function TenderSynthese({ tender, analysis, document, pdfSignedUrl }: TenderSyntheseProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Score & Provider */}
      <Card>
        <CardHeader>
          <CardTitle>Score d&apos;opportunité</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TenderScoreBadge score={tender.opportunity_score} />
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              <span className="font-medium">Fournisseur IA :</span>{' '}
              {analysis.provider}
              {analysis.model ? ` (${analysis.model})` : ''}
            </div>
            {analysis.library_snapshot && (
              <div>
                <span className="font-medium">Contexte bibliothèque :</span>{' '}
                {analysis.library_snapshot.items_count} entrées ·{' '}
                {Math.round(analysis.library_snapshot.total_chars / 1000)} k caractères
              </div>
            )}
            {document && (
              <div>
                <span className="font-medium">Document :</span>{' '}
                <code>{document.filename}</code>
                {document.page_count ? ` · ${document.page_count} pages` : ''}
                {document.size_bytes
                  ? ` · ${Math.round(document.size_bytes / 1024)} Ko`
                  : ''}
                {pdfSignedUrl && (
                  <a href={pdfSignedUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-brand-600 hover:underline">
                    Ouvrir le PDF source
                  </a>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Résumé */}
      <Card>
        <CardHeader>
          <CardTitle>Résumé</CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.summary ? (
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {analysis.summary}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">Aucun résumé disponible.</p>
          )}
        </CardContent>
      </Card>

      {/* Infos AO */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium text-foreground">Titre</dt>
              <dd className="text-muted-foreground mt-0.5">{tender.title}</dd>
            </div>
            {tender.client_name && (
              <div>
                <dt className="font-medium text-foreground">Client</dt>
                <dd className="text-muted-foreground mt-0.5">{tender.client_name}</dd>
              </div>
            )}
            {tender.deadline && (
              <div>
                <dt className="font-medium text-foreground">Échéance</dt>
                <dd className="text-muted-foreground mt-0.5">
                  {new Date(tender.deadline).toLocaleDateString('fr-FR')}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
