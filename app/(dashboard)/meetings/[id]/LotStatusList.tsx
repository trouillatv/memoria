'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldOff, Loader2, Check, Ban, Clock } from 'lucide-react'
import { revokeActionDistributionAction } from './share-actions'
import type { DistributionStatusRow } from '@/lib/db/action-distribution'

function ago(iso: string | null): string {
  if (!iso) return ''
  const d = Math.max(0, Date.now() - new Date(iso).getTime())
  const days = Math.floor(d / 86_400_000)
  if (days >= 1) return `il y a ${days} j`
  const hours = Math.floor(d / 3_600_000)
  if (hours >= 1) return `il y a ${hours} h`
  const min = Math.floor(d / 60_000)
  return min >= 1 ? `il y a ${min} min` : "à l'instant"
}

/** Les 3 étapes explicites du tunnel : Envoyé → Lu → Rempli. */
function Steps({ read, filled, dead }: { read: boolean; filled: boolean; dead: boolean }) {
  const steps = [
    { label: 'Envoyé', done: true },
    { label: 'Lu', done: read },
    { label: 'Rempli', done: filled },
  ]
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
              dead
                ? 'border-border bg-muted text-muted-foreground/60'
                : s.done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-dashed border-muted-foreground/30 bg-background text-muted-foreground/60'
            }`}
          >
            {s.done && !dead && <Check className="h-2.5 w-2.5" />}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground/30">→</span>}
        </div>
      ))}
    </div>
  )
}

function LotRow({ reportId, lot }: { reportId: string; lot: DistributionStatusRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const read = (lot.access_count ?? 0) > 0 || !!lot.submitted_at
  const filled = !!lot.submitted_at
  const dead = lot.funnel === 'revoked' || lot.funnel === 'expired'
  const active = !dead

  function revoke() {
    start(async () => {
      const res = await revokeActionDistributionAction({ distributionId: lot.id, reportId })
      if (res.ok) router.refresh()
    })
  }

  return (
    <li className="rounded-lg border bg-card p-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{lot.recipient_label}</span>
        <span className="text-xs text-muted-foreground shrink-0">{lot.total} action{lot.total > 1 ? 's' : ''}</span>
      </div>

      <Steps read={read} filled={filled} dead={dead} />

      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {lot.funnel === 'revoked' && <span className="inline-flex items-center gap-1 text-rose-700"><ShieldOff className="h-3 w-3" />Lien révoqué</span>}
        {lot.funnel === 'expired' && <span className="inline-flex items-center gap-1 text-amber-700"><Clock className="h-3 w-3" />Lien expiré</span>}
        {filled ? (
          <>
            {lot.done > 0 && <span className="inline-flex items-center gap-0.5 text-emerald-700"><Check className="h-3 w-3" />{lot.done} faite{lot.done > 1 ? 's' : ''}</span>}
            {lot.blocked > 0 && <span className="inline-flex items-center gap-0.5 text-rose-700"><Ban className="h-3 w-3" />{lot.blocked} bloquée{lot.blocked > 1 ? 's' : ''}</span>}
            <span>· {lot.submitted_by_name ?? "l'entreprise"} {ago(lot.submitted_at)}</span>
          </>
        ) : read ? (
          <span>ouvert {ago(lot.accessed_at)}, pas encore rempli</span>
        ) : !dead ? (
          <span>pas encore ouvert</span>
        ) : null}
      </div>

      {active && (
        <button
          type="button" onClick={revoke} disabled={pending}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-rose-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldOff className="h-3 w-3" />} Révoquer le lien
        </button>
      )}
    </li>
  )
}

/** Statut des lots confiés : indique pour chacun si le QR/lien est ENVOYÉ, LU
 *  (ouvert par l'entreprise) et REMPLI (déclaration soumise). C'est la donnée
 *  qui valide LA question du pilote : « les entreprises acceptent-elles de
 *  répondre ? » — pas « savent-elles scanner ? ». */
export function LotStatusList({ reportId, lots }: { reportId: string; lots: DistributionStatusRow[] }) {
  if (lots.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Lots confiés aux entreprises ({lots.length})
      </p>
      <ul className="space-y-2">
        {lots.map((lot) => (
          <LotRow key={lot.id} reportId={reportId} lot={lot} />
        ))}
      </ul>
    </div>
  )
}
