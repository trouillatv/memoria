// Sprint 6 — Section "Liens de partage actifs" sur /preuves/[id].
//
// Doctrine V5 verrou V3 : wording de clôture sobre ("Clôturé", "Émis le X",
// "Consulté le Y"). Aucun verbe d'évaluation, aucun calcul de durée
// ("3 jours pour clôturer" = INTERDIT). Format passif, dates uniquement.
//
// Composant server : rendu de la liste + injection de la dialog client
// CloseDossierDialog pour chaque card.

import { MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { ProofShareToken, ShareTokenComment } from '@/lib/db/proof-share'
import { formatDateLong } from '@/lib/format'
import { CloseDossierDialog } from './CloseDossierDialog'
import { closeDossierAction, reopenDossierAction } from './closure-actions'

interface ShareTokensSectionProps {
  tokens: ProofShareToken[]
  commentsByToken: Map<string, ShareTokenComment[]>
  commentPhotoUrls: Map<string, string>
}

export function ShareTokensSection({ tokens, commentsByToken, commentPhotoUrls }: ShareTokensSectionProps) {
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
          <ShareTokenCard key={t.id} token={t} comments={commentsByToken.get(t.id) ?? []} commentPhotoUrls={commentPhotoUrls} />
        ))}
      </CardContent>
    </Card>
  )
}

function ShareTokenCard({ token, comments, commentPhotoUrls }: { token: ProofShareToken; comments: ShareTokenComment[]; commentPhotoUrls: Map<string, string> }) {
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

      {/* Commentaires reçus du visiteur externe */}
      {comments.length > 0 && (
        <div className="border-t border-border/40 pt-2 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            {comments.length} commentaire{comments.length > 1 ? 's' : ''} reçu{comments.length > 1 ? 's' : ''}
          </div>
          {comments.map((c) => (
            <div key={c.id} className="rounded-md bg-muted/40 border border-border/60 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.visitor_label || 'Visiteur externe'}</span>
                <span>·</span>
                <span>{new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{c.comment}</p>
              {c.photo_paths && c.photo_paths.length > 0 && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {c.photo_paths.map((path) => {
                    const url = commentPhotoUrls.get(path)
                    if (!url) return null
                    return (
                      <a key={path} href={url} target="_blank" rel="noopener noreferrer" className="block shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-16 h-16 rounded object-cover border border-border/40 hover:opacity-80 transition-opacity" />
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
