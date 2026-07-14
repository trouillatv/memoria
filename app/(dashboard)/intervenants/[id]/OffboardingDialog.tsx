'use client'

// Parcours d'offboarding GUIDÉ (Vincent 2026-05-27) : quand une personne quitte
// l'entreprise, on enchaîne en un seul geste les 3 actions qui étaient séparées —
// 1) date de fin de contrat, 2) passation (transmettre sa mémoire à l'équipe qui
// reprend), 3) désactivation du compte. Sujet = la mémoire transmise, jamais la
// personne. Réutilise les actions existantes. Désactivation = admin uniquement.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  LogOut, Calendar, ArrowRightLeft, UserX, CheckCircle2, ArrowRight, ExternalLink,
} from 'lucide-react'
import { updateContractEndDateAction } from '@/app/(dashboard)/continuite/actions'
import { createMemberChangeBriefAction } from '@/app/(dashboard)/handovers/actions'
import { deactivateIntervenantAction } from './offboarding-actions'

interface Team { id: string; name: string }

interface Props {
  subjectUserId: string
  subjectLabel: string
  initialEndDate: string | null
  currentTeams: Team[]
  allTeams: Team[]
  viewerIsAdmin: boolean
}

type Step = 1 | 2 | 3 | 4

const STEP_META: { n: Step; label: string; icon: typeof Calendar }[] = [
  { n: 1, label: 'Date de fin', icon: Calendar },
  { n: 2, label: 'Passation', icon: ArrowRightLeft },
  { n: 3, label: 'Désactivation', icon: UserX },
]

export function OffboardingDialog(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [pending, start] = useTransition()

  const [endDate, setEndDate] = useState(props.initialEndDate ?? '')
  const [dateDone, setDateDone] = useState(!!props.initialEndDate)
  const [sourceTeam, setSourceTeam] = useState(props.currentTeams[0]?.id ?? '')
  const [targetTeam, setTargetTeam] = useState('')
  const [briefId, setBriefId] = useState<string | null>(null)
  const [deactivated, setDeactivated] = useState(false)

  function reset() {
    setStep(1); setDeactivated(false); setBriefId(null)
  }

  function saveDate() {
    start(async () => {
      const r = await updateContractEndDateAction({ targetUserId: props.subjectUserId, date: endDate || null })
      if (!r.ok) { toast.error(r.error ?? 'Erreur'); return }
      setDateDone(!!endDate)
      toast.success('Date de fin enregistrée')
      setStep(2)
    })
  }

  function makeBrief() {
    if (!endDate) { toast.error("Renseigne la date de fin (étape 1) : elle fixe la date d'effet du passage de témoin."); setStep(1); return }
    if (!targetTeam) { toast.error("Choisis l'équipe qui reprend la mémoire."); return }
    start(async () => {
      const r = await createMemberChangeBriefAction({
        subjectUserId: props.subjectUserId,
        sourceTeamId: sourceTeam || null,
        targetTeamId: targetTeam,
        // La passation devient effective à la date de fin saisie à l'étape 1.
        effectiveDate: endDate || null,
      })
      if (!r.ok) { toast.error(r.error ?? 'Erreur'); return }
      setBriefId(r.briefId ?? null)
      toast.success('Brief de passation créé')
    })
  }

  function deactivate() {
    start(async () => {
      const r = await deactivateIntervenantAction({ userId: props.subjectUserId })
      if (!r.ok) { toast.error(r.error ?? 'Erreur'); return }
      setDeactivated(true)
      toast.success('Compte désactivé')
      setStep(4)
      router.refresh()
    })
  }

  const selectCls =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset() }}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="text-muted-foreground">
            <LogOut className="h-3.5 w-3.5" />
            Préparer le départ
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Départ de {props.subjectLabel}</DialogTitle>
          <DialogDescription>
            On transmet sa mémoire du terrain avant qu&apos;elle ne parte avec elle.
          </DialogDescription>
        </DialogHeader>

        {/* Fil d'étapes */}
        {step < 4 && (
          <ol className="flex items-center gap-1 text-[11px]">
            {STEP_META.map(({ n, label, icon: Icon }) => (
              <li key={n} className={`flex items-center gap-1 rounded-md px-2 py-1 ${step === n ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}`}>
                <Icon className="h-3 w-3" />
                {label}
              </li>
            ))}
          </ol>
        )}

        {/* Étape 1 — Date de fin */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Renseignez la date de fin de contrat. Obligatoire : elle fixe la date
              d&apos;effet du passage de témoin et déclenche l&apos;anticipation
              (radar « À anticiper »).
            </p>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" onClick={saveDate} disabled={pending || !endDate}>
                Enregistrer et continuer <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Étape 2 — Passation */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Quelle équipe reprend les chantiers de cette personne ? On fige sa mémoire
              (accès, à-savoir, anomalies) dans un brief transmis à la relève.
            </p>
            {props.currentTeams.length > 0 && (
              <label className="block text-xs">
                <span className="text-muted-foreground">Équipe d&apos;origine</span>
                <select className={selectCls} value={sourceTeam} onChange={(e) => setSourceTeam(e.target.value)}>
                  {props.currentTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <label className="block text-xs">
              <span className="text-muted-foreground">Équipe qui reprend</span>
              <select className={selectCls} value={targetTeam} onChange={(e) => setTargetTeam(e.target.value)}>
                <option value="">— choisir —</option>
                {props.allTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>

            {briefId ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 text-sm flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" /> Brief créé
                </span>
                <a href={`/handovers/${briefId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                  Ouvrir <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : null}

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setStep(3)} disabled={pending}>
                Passer
              </Button>
              {briefId ? (
                <Button size="sm" onClick={() => setStep(3)}>Continuer <ArrowRight className="h-3.5 w-3.5" /></Button>
              ) : (
                <Button size="sm" onClick={makeBrief} disabled={pending || !endDate} title={!endDate ? 'Date de fin requise (étape 1)' : undefined}>Préparer la passation</Button>
              )}
            </div>
          </div>
        )}

        {/* Étape 3 — Désactivation */}
        {step === 3 && (
          <div className="space-y-3">
            {props.viewerIsAdmin ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Au départ effectif, désactivez le compte : la personne disparaît des
                  listes. <strong className="text-foreground">Sa mémoire déposée reste</strong>
                  {' '}(traces, photos, briefs) — rien n&apos;est perdu.
                </p>
                <div className="flex justify-between gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setStep(4)} disabled={pending}>
                    Plus tard
                  </Button>
                  <Button variant="destructive" size="sm" onClick={deactivate} disabled={pending}>
                    <UserX className="h-3.5 w-3.5" /> Désactiver le compte
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  La désactivation du compte est <strong className="text-foreground">réservée à un administrateur</strong>.
                  Vous avez préparé la date de fin et la passation : un admin finalisera la désactivation.
                </p>
                <div className="flex justify-end pt-1">
                  <Button size="sm" onClick={() => setStep(4)}>Terminer</Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Étape 4 — Récap */}
        {step === 4 && (
          <div className="space-y-3">
            <ul className="space-y-2 text-sm">
              <RecapLine done={dateDone} label="Date de fin de contrat renseignée" />
              <RecapLine done={!!briefId} label="Passation préparée (mémoire transmise)" />
              <RecapLine done={deactivated} label={props.viewerIsAdmin ? 'Compte désactivé' : 'Désactivation : à finaliser par un admin'} />
            </ul>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => { setOpen(false); router.refresh() }}>Fermer</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecapLine({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckCircle2 className={`h-4 w-4 shrink-0 ${done ? 'text-emerald-600' : 'text-muted-foreground/40'}`} />
      <span className={done ? '' : 'text-muted-foreground'}>{label}</span>
    </li>
  )
}
