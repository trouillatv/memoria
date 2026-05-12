// Phase 10 — Slice 10.3 : affichage participants sur le détail intervention.
//
// Doctrine V3 :
//   ✅ « Participants de l'intervention X » — autorisé
//   ❌ Noms cliquables → ❌ aucun lien vers un profil agent (asymétrie événement vs personne)
//   ✅ Référent affiché comme tag, jamais comme hiérarchie
//   ✅ État vide = « Participants non confirmés » (règle V3 non-écriture auto)

import { Users } from 'lucide-react'
import type { ParticipantWithUser } from '@/lib/db/intervention-participants'

interface Props {
  assignedTeam: { name: string; color: string | null } | null
  participants: ParticipantWithUser[]
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split('@')[0]
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Convertit un hex #rrggbb → fond très pâle (90% blanc) pour le pastille équipe. */
function hexToVeryPale(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * 0.1 + 255 * 0.9)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export function ParticipantsPanel({ assignedTeam, participants }: Props) {
  const referents = participants.filter((p) => p.role === 'referent')
  const others = participants.filter((p) => p.role !== 'referent')
  const ordered = [...referents, ...others]
  const isEmpty = ordered.length === 0

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
          <Users className="h-3.5 w-3.5" />
          Équipe & participants
        </h2>
        {assignedTeam && (
          <span
            className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border"
            style={{
              backgroundColor: hexToVeryPale(assignedTeam.color),
              borderColor: assignedTeam.color ?? undefined,
            }}
            title="Équipe affectée à l'intervention (organisation prévue)"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: assignedTeam.color ?? '#94a3b8' }}
              aria-hidden
            />
            <span className="font-medium text-foreground">{assignedTeam.name}</span>
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-sm italic text-muted-foreground">
          Participants non confirmés.
          {assignedTeam && (
            <>
              {' '}
              <span className="not-italic">L&apos;équipe {assignedTeam.name} est affectée à cette intervention ;
              les participants réels seront confirmés sur le terrain.</span>
            </>
          )}
        </div>
      ) : (
        <ul
          className="flex flex-wrap gap-2"
          aria-label={`${ordered.length} participant${ordered.length > 1 ? 's' : ''}`}
        >
          {ordered.map((p) => {
            const displayName = p.user.full_name?.trim() || p.user.email.split('@')[0]
            const isReferent = p.role === 'referent'
            return (
              <li
                key={p.user_id}
                className="inline-flex items-center gap-2 rounded-full border bg-background pl-1 pr-3 py-0.5 text-sm"
              >
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                  aria-hidden
                >
                  {initials(p.user.full_name, p.user.email)}
                </span>
                <span className="text-foreground">{displayName}</span>
                {isReferent && (
                  <span
                    className="ml-0.5 inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-600/10"
                    title="Référent — point de contact opérationnel pour cette intervention"
                  >
                    Référent
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
