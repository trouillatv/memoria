// Statut « partagé à un externe » sur mobile : on voyait le bouton Partager
// mais jamais si un lien avait déjà été envoyé, consulté ou confirmé.
// Présentation pure (données déjà chargées par la page). Révocation = desktop.

import { CheckCircle2, Eye, Clock, Share2, ShieldOff } from 'lucide-react'
import type { InterventionToken } from '@/lib/db/intervention-tokens'

const FR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()] ?? ''} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type State = 'confirmed' | 'accessed' | 'sent'
function stateOf(t: InterventionToken): State {
  if (t.validated_at) return 'confirmed'
  if (t.accessed_at || t.access_count > 0) return 'accessed'
  return 'sent'
}

export function ExternalShareStatusMobile({ tokens }: { tokens: InterventionToken[] }) {
  const active = tokens.filter((t) => !t.revoked_at)
  if (active.length === 0) return null

  // Tri : confirmé > consulté > envoyé, puis plus récent d'abord.
  const rank: Record<State, number> = { confirmed: 0, accessed: 1, sent: 2 }
  const sorted = [...active].sort((a, b) => {
    const d = rank[stateOf(a)] - rank[stateOf(b)]
    if (d !== 0) return d
    return (b.created_at < a.created_at ? -1 : 1)
  })

  return (
    <section className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        Partagé à un externe
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {active.length} lien{active.length > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((t) => {
          const state = stateOf(t)
          const when = t.validated_at ?? t.accessed_at ?? t.created_at
          const name = t.validated_by_name ?? t.recipient_label ?? 'Intervenant externe'
          return (
            <li key={t.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-2">
              {state === 'confirmed' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />Confirmé
                </span>
              ) : state === 'accessed' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                  <Eye className="h-3 w-3" />Consulté
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  <Clock className="h-3 w-3" />Envoyé
                </span>
              )}
              <span className="text-xs text-foreground truncate">{name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{fmt(when)}</span>
            </li>
          )
        })}
      </ul>
      {sorted.some((t) => stateOf(t) === 'sent') && (
        <p className="text-[11px] text-muted-foreground/70 inline-flex items-center gap-1">
          <ShieldOff className="h-3 w-3" /> Révocable depuis la fiche intervention (ordinateur).
        </p>
      )}
    </section>
  )
}
