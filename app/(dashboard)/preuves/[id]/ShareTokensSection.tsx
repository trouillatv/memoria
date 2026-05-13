// Sprint 6 — Section "Liens de partage actifs" sur /preuves/[id].
//
// Doctrine V5 verrou V3 : wording de clôture sobre ("Clôturé", "Émis le X",
// "Consulté le Y"). Aucun verbe d'évaluation, aucun calcul de durée
// ("3 jours pour clôturer" = INTERDIT). Format passif, dates uniquement.
//
// Composant server : rendu de la liste + injection de la dialog client
// CloseDossierDialog pour chaque card.

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { ProofShareToken } from '@/lib/db/proof-share'
import { formatDateLong } from '@/lib/format'
import { CloseDossierDialog } from './CloseDossierDialog'
import { closeDossierAction, reopenDossierAction } from './closure-actions'

interface ShareTokensSectionProps {
  tokens: ProofShareToken[]
}

export function ShareTokensSection({ tokens }: ShareTokensSectionProps) {
  if (tokens.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Liens de partage actifs ({tokens.length})
        </CardTitle>
        <CardDescription>
          Cycle de vie des dossiers de preuves partagés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tokens.map((t) => (
          <ShareTokenCard key={t.id} token={t} />
        ))}
      </CardContent>
    </Card>
  )
}

function ShareTokenCard({ token }: { token: ProofShareToken }) {
  const isExpired = new Date(token.expires_at).getTime() < Date.now()
  return (
    <div
      data-testid={`share-token-card-${token.id}`}
      className="rounded-md border border-border bg-card px-3 py-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>
            Lien créé le{' '}
            <span className="text-foreground">{formatDateLong(token.created_at)}</span>
          </div>
          <div>
            Expire le{' '}
            <span className={isExpired ? 'italic' : 'text-foreground'}>
              {formatDateLong(token.expires_at)}
            </span>
            {isExpired && ' (expiré)'}
          </div>
        </div>

        {/* Action principale : Clôturer / état Clôturé (cf. CloseDossierDialog) */}
        <CloseDossierDialog
          tokenId={token.id}
          closedAt={token.closed_at}
          closureNote={token.closure_note}
          closeAction={closeDossierAction}
          reopenAction={reopenDossierAction}
        />
      </div>

      {/* Mini timeline horizontale — format passif, dates uniquement.
          Doctrine V3 : aucune durée calculée, aucune évaluation. */}
      <ShareTokenTimeline token={token} />
    </div>
  )
}

function ShareTokenTimeline({ token }: { token: ProofShareToken }) {
  // 3 segments possibles : Émis · Consulté · Clôturé.
  // On affiche uniquement les segments dont l'événement a eu lieu.
  const segments: { key: string; label: string; date: string }[] = [
    {
      key: 'emitted',
      label: 'Émis le',
      date: token.created_at,
    },
  ]
  if (token.access_count > 0 && token.last_accessed_at) {
    segments.push({
      key: 'accessed',
      label: 'Consulté le',
      date: token.last_accessed_at,
    })
  }
  if (token.closed_at) {
    segments.push({
      key: 'closed',
      label: 'Clôturé le',
      date: token.closed_at,
    })
  }

  return (
    <ol
      data-testid={`share-token-timeline-${token.id}`}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/40"
    >
      {segments.map((seg, i) => (
        <li key={seg.key} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-border">·</span>}
          <span>
            {seg.label}{' '}
            <span className="text-foreground">{formatDateLong(seg.date)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
