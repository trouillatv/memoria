'use client'

// « Intervention » DEPUIS le + mobile — le geste terrain qui manquait : planifier
// une intervention PONCTUELLE (une fois) sans passer par le desktop. Flux : chantier
// → équipe → date → créneau/heure → objet → enregistrer. Le mot « mission » n'apparaît
// jamais : derrière, l'intervention s'accroche à la mission système du chantier, mais
// l'utilisateur ne voit que son OBJET. Cf. A2 (mig 189).

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Wrench, X, ChevronRight, Loader2, ArrowLeft, Users, Check } from 'lucide-react'
import { toast } from 'sonner'
import { listMeetingSitesAction } from './meeting-actions'
import { listFieldTeamsAction, createPonctuelInterventionAction, type FieldTeamOption } from './ponctuel-actions'

type Site = { id: string; name: string }
type Slot = 'morning' | 'afternoon' | 'evening'

const SLOTS: { slug: Slot; label: string }[] = [
  { slug: 'morning', label: 'Matin' },
  { slug: 'afternoon', label: 'Après-midi' },
  { slug: 'evening', label: 'Soir' },
]

function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const INPUT = 'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

export function InterventionLauncher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState<Site[] | null>(null)
  const [teams, setTeams] = useState<FieldTeamOption[] | null>(null)
  const [site, setSite] = useState<Site | null>(null)
  const [teamId, setTeamId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [slot, setSlot] = useState<Slot>('morning')
  const [useTime, setUseTime] = useState(false)
  const [hhmm, setHhmm] = useState('08:00')
  const [label, setLabel] = useState('')
  const [comment, setComment] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    if (sites === null) listMeetingSitesAction().then(setSites).catch(() => setSites([]))
    if (teams === null) listFieldTeamsAction().then(setTeams).catch(() => setTeams([]))
  }, [open, sites, teams])

  function close() {
    setOpen(false)
    setSite(null); setTeamId(''); setDate(todayIso()); setSlot('morning')
    setUseTime(false); setHhmm('08:00'); setLabel(''); setComment('')
  }

  const canSave = !!site && !!teamId && label.trim().length > 0 && !pending

  function save() {
    if (!site || !teamId || label.trim().length === 0) return
    startTransition(async () => {
      const res = await createPonctuelInterventionAction({
        siteId: site.id,
        teamId,
        date,
        ...(useTime ? { hhmm } : { slot }),
        label: label.trim(),
        comment: comment.trim() || undefined,
      })
      if (res.ok) {
        toast.success('Intervention planifiée', { duration: 1500 })
        close()
        router.push(`/m/intervention/${res.interventionId}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full w-full flex-col items-center justify-start gap-2.5 rounded-2xl bg-amber-50 px-2 py-5 text-center text-[13px] font-medium leading-snug text-amber-700 active:scale-[0.97] transition-transform dark:bg-amber-950/30 dark:text-amber-300"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/80 text-amber-600 dark:bg-white/10 dark:text-amber-300">
          <Wrench className="h-7 w-7" />
        </span>
        <span className="break-words">Nouvelle intervention</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3">
          <div className="my-2 w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {site ? 'Nouvelle intervention' : 'Intervention — pour quel chantier ?'}
              </h3>
              <button type="button" onClick={close} aria-label="Fermer" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!site ? (
              /* Étape 1 — choisir le chantier. */
              sites === null ? (
                <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des chantiers…
                </p>
              ) : sites.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Aucun chantier disponible.</p>
              ) : (
                <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                  {sites.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSite(s)}
                        className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-left text-sm font-medium hover:bg-accent active:scale-[0.99] transition-transform"
                      >
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              /* Étape 2 — le formulaire terrain. */
              <div className="space-y-3.5">
                <button type="button" onClick={() => setSite(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> {site.name}
                </button>

                {/* Objet — obligatoire, en premier (c'est le cœur). */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Objet de l’intervention *</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className={INPUT}
                    maxLength={200}
                    placeholder="ex. Reprise étanchéité terrasse"
                    disabled={pending}
                    autoFocus
                  />
                </div>

                {/* Équipe / intervenant. */}
                <div className="space-y-1.5">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Équipe / intervenant *
                  </label>
                  {teams === null ? (
                    <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
                    </p>
                  ) : (
                    <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={INPUT} disabled={pending}>
                      <option value="">— choisir —</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Date. */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Date *</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} disabled={pending} />
                </div>

                {/* Créneau OU heure précise. */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Quand ?</label>
                    <button
                      type="button"
                      onClick={() => setUseTime((v) => !v)}
                      className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400"
                    >
                      {useTime ? 'Choisir un créneau' : 'Heure précise'}
                    </button>
                  </div>
                  {useTime ? (
                    <input type="time" value={hhmm} onChange={(e) => setHhmm(e.target.value)} className={INPUT} disabled={pending} />
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {SLOTS.map((s) => {
                        const active = slot === s.slug
                        return (
                          <button
                            key={s.slug}
                            type="button"
                            onClick={() => setSlot(s.slug)}
                            className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'text-muted-foreground active:bg-accent'}`}
                          >
                            {s.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Commentaire — optionnel. */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Commentaire <span className="font-normal text-muted-foreground/70">(facultatif)</span>
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className={`${INPUT} min-h-[60px] resize-none`}
                    maxLength={1000}
                    placeholder="Précisions pour l’équipe…"
                    disabled={pending}
                  />
                </div>

                <button
                  type="button"
                  onClick={save}
                  disabled={!canSave}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Enregistrer l’intervention
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
