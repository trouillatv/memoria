'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, Clock, ShieldOff, Hourglass, XCircle, Share2, ChevronDown,
  Eye, ListChecks, Camera, MessageSquare, PenLine,
} from 'lucide-react'
import type { InterventionToken } from '@/lib/db/intervention-tokens'
import { GenerateInterventionTokenButton } from '@/app/(dashboard)/briefing/GenerateInterventionTokenButton'
import { revokeTokenAction } from './token-revoke-action'

interface Props {
  interventionId: string
  missionName: string
  siteName: string
  tokens: InterventionToken[]
  checklistDone: number
  checklistTotal: number
  externalPhotosByToken: Record<string, Array<{ thumb: string; full: string }>>
  shareChecklistItems?: Array<{ id: string; label: string; delegated: boolean }>
  /** Bilan par contribution : token_id → { tâches exécutées, total du périmètre }. */
  perTokenStats?: Record<string, { executed: number; total: number }>
}

const FR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()] ?? ''} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()] ?? ''}`
}

type State = 'validated' | 'revoked' | 'expired' | 'accessed' | 'pending'
function tokenState(t: InterventionToken): State {
  if (t.validated_at) return 'validated'
  if (t.revoked_at) return 'revoked'
  if (t.expires_at && new Date(t.expires_at) < new Date()) return 'expired'
  if (t.accessed_at || t.access_count > 0) return 'accessed'
  return 'pending'
}

function StateBadge({ state }: { state: State }) {
  const map: Record<State, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    validated: { label: 'Validé', cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
    accessed: { label: 'Consulté', cls: 'bg-sky-100 text-sky-700', Icon: Eye },
    pending: { label: 'En attente', cls: 'bg-blue-100 text-blue-700', Icon: Clock },
    expired: { label: 'Expiré', cls: 'bg-muted text-muted-foreground', Icon: Hourglass },
    revoked: { label: 'Révoqué', cls: 'bg-red-100 text-red-700', Icon: ShieldOff },
  }
  const { label, cls, Icon } = map[state]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />{label}
    </span>
  )
}

// ── Carte « activité d'un intervenant externe » (vue métier) ────────────────
function ExternalActivityRow({
  token, interventionId, checklistDone, checklistTotal, photos,
}: {
  token: InterventionToken
  interventionId: string
  /** Tâches exécutées / total — déjà résolu au niveau de CETTE contribution. */
  checklistDone: number
  checklistTotal: number
  photos: Array<{ thumb: string; full: string }>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const state = tokenState(token)
  const isRevocable = state === 'pending' || state === 'accessed'
  const when = token.validated_at ?? token.accessed_at ?? token.created_at

  function handleRevoke() {
    startTransition(async () => {
      await revokeTokenAction(token.id, interventionId)
      router.refresh()
    })
  }

  return (
    <li className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <StateBadge state={state} />
        <span className="text-sm font-medium">
          {token.validated_by_name ?? token.recipient_label ?? 'Intervenant externe'}
        </span>
        {token.recipient_label && token.validated_by_name && (
          <span className="text-[10px] text-muted-foreground">· {token.recipient_label}</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">{formatShort(when)}</span>
      </div>

      {/* Preuves (uniquement si validé) */}
      {state === 'validated' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            {checklistTotal > 0 && (
              <span className={`inline-flex items-center gap-1 ${checklistDone >= checklistTotal ? 'text-emerald-700' : 'text-amber-700'}`}>
                <ListChecks className="h-3.5 w-3.5" />Checklist {checklistDone}/{checklistTotal}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Camera className="h-3.5 w-3.5" />{photos.length} photo{photos.length > 1 ? 's' : ''}
            </span>
            {token.signature_data_url && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <PenLine className="h-3.5 w-3.5" />Signature
              </span>
            )}
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5">
              {photos.map((p, i) => (
                <a key={i} href={p.full} target="_blank" rel="noopener noreferrer" className="block rounded overflow-hidden border bg-muted hover:opacity-90 transition-opacity">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt={`Photo externe ${i + 1}`} className="aspect-square w-full object-cover" />
                </a>
              ))}
            </div>
          )}

          {token.validation_comment && (
            <p className="text-xs text-foreground/80 italic border-l-2 border-muted pl-2 inline-flex items-start gap-1">
              <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
              « {token.validation_comment} »
            </p>
          )}

          {token.signature_data_url && (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={token.signature_data_url} alt="Signature" className="h-12 rounded border bg-white" />
            </div>
          )}
        </div>
      )}

      {state === 'accessed' && (
        <p className="text-[11px] text-sky-700">Lien consulté — en attente de validation.</p>
      )}

      {/* Détails techniques — repliés (le token est un mécanisme, pas l'info métier) */}
      <details className="group">
        <summary className="cursor-pointer list-none text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
          Détails techniques
        </summary>
        <div className="mt-1.5 space-y-0.5 rounded-md bg-muted/20 p-2 text-[10px] text-muted-foreground">
          <p>Lien créé le {formatShort(token.created_at)}</p>
          {token.accessed_at && <p>Ouvert le {formatShort(token.accessed_at)}{token.access_count > 1 ? ` · ${token.access_count}×` : ''}</p>}
          {token.expires_at && !token.revoked_at && <p>Expire le {formatDay(token.expires_at)}</p>}
          {token.revoked_at && <p>Révoqué le {formatShort(token.revoked_at)}</p>}
          {isRevocable && (
            <button type="button" onClick={handleRevoke} disabled={isPending}
              className="mt-1 inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">
              <XCircle className="h-3 w-3" />{isPending ? 'Révocation…' : 'Révoquer le lien'}
            </button>
          )}
        </div>
      </details>
    </li>
  )
}

export function TokensPanel({
  interventionId, missionName, siteName, tokens, checklistDone, checklistTotal, externalPhotosByToken, shareChecklistItems = [], perTokenStats = {},
}: Props) {
  const [open, setOpen] = useState(false)

  const validations = tokens.filter((t) => t.validated_at).length
  const activeCount = tokens.filter((t) => tokenState(t) === 'pending' || tokenState(t) === 'accessed').length
  const totalPhotos = Object.values(externalPhotosByToken).reduce((s, arr) => s + arr.length, 0)
  const totalComments = tokens.filter((t) => t.validation_comment).length
  const totalSignatures = tokens.filter((t) => t.signature_data_url).length
  const showAggregate = validations > 1

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-muted/30 transition-colors text-left">
        <Share2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium">Activités externes</span>
        {validations > 0 && (
          <span className="ml-1 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            {validations} validé{validations > 1 ? 's' : ''}
          </span>
        )}
        {validations === 0 && activeCount > 0 && (
          <span className="ml-1 inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            {activeCount} en attente
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-3">
          {/* Agrégat quand plusieurs intervenants */}
          {showAggregate && (
            <div className="flex items-center gap-4 text-xs flex-wrap rounded-lg bg-muted/30 px-3 py-2">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{validations} validations</span>
              <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{totalPhotos} photos</span>
              <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{totalComments} commentaires</span>
              <span className="inline-flex items-center gap-1"><PenLine className="h-3.5 w-3.5" />{totalSignatures} signatures</span>
            </div>
          )}

          {tokens.length > 0 && (
            <ul className="space-y-2">
              {tokens.map((t) => {
                const stats = perTokenStats[t.id]
                return (
                  <ExternalActivityRow
                    key={t.id}
                    token={t}
                    interventionId={interventionId}
                    checklistDone={stats ? stats.executed : checklistDone}
                    checklistTotal={stats ? stats.total : checklistTotal}
                    photos={externalPhotosByToken[t.id] ?? []}
                  />
                )
              })}
            </ul>
          )}

          {/* Partager un nouveau lien */}
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground italic mb-1">
              Déléguer à un sous-traitant, livreur ou bureau de contrôle — il prouve ce qu&apos;il a fait sans compte MemorIA.
            </p>
            <GenerateInterventionTokenButton
              interventionId={interventionId}
              missionName={missionName}
              siteName={siteName}
              checklistItems={shareChecklistItems}
            />
          </div>
        </div>
      )}
    </div>
  )
}
