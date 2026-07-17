// AO-1 L4 — Encart « Capital client » sur la page AO.
//
// Vincent 2026-05-21 : encart factuel pur. Pas de score, pas de prédiction,
// pas de jugement. Aide commercial à voir « ce qu'on sait déjà » sur ce
// client avant de répondre.
//
// Silence positif : si client_name vide OU aucun contrat trouvé, on rend
// quand même un message court (utile pour ne pas laisser l'utilisateur
// dans l'ambiguïté « est-ce que je connais ce client ? »).

import {
  Briefcase, MapPin, ClipboardCheck, AlertTriangle, Camera, FileText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TenderClientCapital } from '@/lib/db/tender-client-capital'

interface Props {
  capital: TenderClientCapital
}

export function TenderClientCapitalCard({ capital }: Props) {
  // Pas de client renseigné — encart muet.
  if (!capital.clientName) return null

  const hasAnyHistory =
    capital.contractsCount > 0 ||
    capital.sitesCount > 0 ||
    capital.interventionsDocumentedCount > 0

  return (
    <Card data-slot="tender-client-capital">
      <CardHeader>
        <CardTitle className="text-base inline-flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          Capital client
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Historique opérationnel connu pour <span className="font-medium text-foreground">{capital.clientName}</span>.
          Pas un score — des faits cumulés que vous pouvez réutiliser dans la réponse.
        </p>

        {!hasAnyHistory ? (
          <p className="text-sm text-muted-foreground italic">
            Aucun contrat précédent ni historique opérationnel n&apos;a été trouvé pour ce client.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  Contrats
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.contractsCount.toLocaleString('fr-FR')}
                </dd>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Chantiers
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.sitesCount.toLocaleString('fr-FR')}
                </dd>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <ClipboardCheck className="h-3 w-3" />
                  Interventions documentées
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.interventionsDocumentedCount.toLocaleString('fr-FR')}
                </dd>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Anomalies traitées
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.anomaliesCount.toLocaleString('fr-FR')}
                </dd>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Camera className="h-3 w-3" />
                  Photos
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.photosCount.toLocaleString('fr-FR')}
                </dd>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <dt className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Documents rattachés
                </dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {capital.documentsCount.toLocaleString('fr-FR')}
                </dd>
              </div>
            </dl>

            {capital.contractNamesSample.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Contrats connus : </span>
                {capital.contractNamesSample.join(' · ')}
                {capital.contractsCount > capital.contractNamesSample.length && (
                  <span> · +{capital.contractsCount - capital.contractNamesSample.length} autres</span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
