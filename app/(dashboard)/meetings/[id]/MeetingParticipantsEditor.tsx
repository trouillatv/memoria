'use client'

// Participants d'une réunion, gérés AU NIVEAU RÉUNION. Pas une checklist de 40
// cases : le casting est un CATALOGUE qu'on interroge. MemorIA s'appuie sur la
// MÉMOIRE de présence (habituels / occasionnels / nouveaux) et permet de
// « reprendre la dernière réunion » — juste dans ~95 % des cas.
//
// JSON léger : on ne stocke que contactId + l'audit (added_after_meeting).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Plus, X, Loader2, RotateCcw, Search } from 'lucide-react'
import {
  addExistingParticipantAction,
  removeParticipantByContactAction,
  addParticipantAction,
  removeParticipantAction,
  copyParticipantsFromLastMeetingAction,
} from './pv-actions'
import type { SiteReportParticipant } from '@/types/db'
import type { SiteContactOption } from '@/lib/db/site-intervenants'

type Attendance = { totalMeetings: number; present: Record<string, number>; lastMeetingContactIds: string[] }

function freqLabel(count: number, total: number): { label: string; cls: string } | null {
  if (total >= 2 && count / total >= 0.6) return { label: 'habituel', cls: 'bg-emerald-50 text-emerald-700' }
  if (count >= 1) return { label: 'occasionnel', cls: 'bg-amber-50 text-amber-800' }
  return { label: 'nouveau', cls: 'bg-sky-50 text-sky-700' }
}

export function MeetingParticipantsEditor({
  reportId,
  participants,
  castingContacts,
  attendance,
}: {
  reportId: string
  participants: SiteReportParticipant[]
  castingContacts: SiteContactOption[]
  attendance: Attendance
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')

  const contactById = useMemo(() => new Map(castingContacts.map((c) => [c.id, c])), [castingContacts])
  const presentIds = useMemo(() => new Set(participants.filter((p) => p.contactId).map((p) => p.contactId as string)), [participants])

  // Catalogue = contacts du casting PAS encore présents, triés par fréquence puis nom.
  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    return castingContacts
      .filter((c) => !presentIds.has(c.id))
      .filter((c) => !q || c.fullName.toLowerCase().includes(q) || (c.companyName ?? '').toLowerCase().includes(q))
      .map((c) => ({ c, count: attendance.present[c.id] ?? 0 }))
      .sort((a, b) => b.count - a.count || a.c.fullName.localeCompare(b.c.fullName))
  }, [castingContacts, presentIds, query, attendance.present])

  const lastMeetingMissing = attendance.lastMeetingContactIds.filter((id) => !presentIds.has(id)).length

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      try {
        const r = await fn()
        if (r.ok) router.refresh(); else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  function addFree() {
    const n = name.trim()
    if (!n) return
    run(() => addParticipantAction(reportId, n, role.trim()))
    setName(''); setRole(''); setAdding(false)
  }

  return (
    <section className="space-y-2">
      <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> Présents ({participants.length})
      </h2>

      {/* Présents actuels — chips supprimables. */}
      {participants.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {participants.map((p, i) => {
            const c = p.contactId ? contactById.get(p.contactId) : null
            return (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs">
                {p.name}
                {(c?.companyName || p.role) && <span className="text-muted-foreground"> · {c?.companyName ?? p.role}</span>}
                {p.addedAfterMeeting ? <span className="text-[10px] italic text-muted-foreground/70"> · ajouté après</span> : null}
                <button type="button" disabled={pending} title="Retirer"
                  onClick={() => run(() => p.contactId ? removeParticipantByContactAction(reportId, p.contactId) : removeParticipantAction(reportId, i))}
                  className="ml-0.5 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">Aucun présent renseigné.</p>
      )}

      {/* Actions : reprendre la dernière réunion (95 % des cas) + ajouter depuis le casting. */}
      <div className="flex flex-wrap items-center gap-2">
        {lastMeetingMissing > 0 && (
          <button type="button" disabled={pending} onClick={() => run(() => copyParticipantsFromLastMeetingAction(reportId))}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Reprendre la dernière réunion ({lastMeetingMissing})
          </button>
        )}
        <button type="button" onClick={() => setShowCatalog((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40">
          <Search className="h-3.5 w-3.5" /> Ajouter depuis le casting
        </button>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40">
            <Plus className="h-3.5 w-3.5" /> Ajouter un participant
          </button>
        )}
      </div>

      {/* Catalogue cherchable (pas une liste permanente de 40 cases). */}
      {showCatalog && (
        <div className="space-y-1.5 rounded-lg border bg-card p-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un contact du chantier…" autoFocus
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          {catalog.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Aucun contact disponible (renseignez le casting du chantier).</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {catalog.map(({ c, count }) => {
                const fl = freqLabel(count, attendance.totalMeetings)
                return (
                  <li key={c.id}>
                    <button type="button" disabled={pending} onClick={() => run(() => addExistingParticipantAction(reportId, c.id))}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 disabled:opacity-50">
                      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{c.fullName}</span>
                      {c.companyName && <span className="text-xs text-muted-foreground">· {c.companyName}</span>}
                      {fl && <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium ${fl.cls}`}>{fl.label}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Ajout d'un participant libre (l'exception). */}
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-card p-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom" autoFocus
            className="min-w-[9rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Rôle (optionnel)"
            className="w-36 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
          <button type="button" disabled={pending || !name.trim()} onClick={addFree}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
          </button>
          <button type="button" onClick={() => { setAdding(false); setName(''); setRole('') }} className="text-xs text-muted-foreground hover:text-foreground">Annuler</button>
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </section>
  )
}
