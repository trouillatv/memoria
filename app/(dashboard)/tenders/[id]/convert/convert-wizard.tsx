'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createContractAction } from '../engagements-actions'
import { EngagementCurationView } from '../engagement-curation-view'
import type { DbEngagement, DbTender } from '@/types/db'

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: Record<Step, string> = {
  1: 'Identification',
  2: 'Engagements',
  3: 'Sites',
  4: 'Récap',
}

export function ConvertWizard({
  tender,
  engagements,
}: {
  tender: DbTender
  engagements: DbEngagement[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [pending, startTransition] = useTransition()

  // Étape 1 — identification
  const [name, setName] = useState(tender.title)
  const [clientName, setClientName] = useState(tender.client_name ?? '')
  const today = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState('')

  function submit() {
    const fd = new FormData()
    fd.set('tender_id', tender.id)
    fd.set('name', name)
    fd.set('client_name', clientName)
    fd.set('start_date', startDate)
    if (endDate) fd.set('end_date', endDate)

    startTransition(async () => {
      const r = await createContractAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else if (r && 'contractId' in r) {
        const count = r.activatedCount ?? 0
        toast.success(
          `Contrat créé · ${count} engagement${count > 1 ? 's' : ''} activé${count > 1 ? 's' : ''}`
        )
        router.push(`/contracts/${r.contractId}`)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Header step={step} />

      {step === 1 && (
        <Step1
          name={name} setName={setName}
          clientName={clientName} setClientName={setClientName}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2
          engagements={engagements}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <Step3 onBack={() => setStep(2)} onNext={() => setStep(4)} />
      )}

      {step === 4 && (
        <Step4
          name={name}
          clientName={clientName}
          engagementsCount={engagements.length}
          pending={pending}
          onBack={() => setStep(3)}
          onSubmit={submit}
        />
      )}
    </div>
  )
}

function Header({ step }: { step: Step }) {
  return (
    <nav aria-label="Progression du wizard" className="flex items-center gap-2 text-xs">
      {([1, 2, 3, 4] as Step[]).map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          <span
            className={
              s === step
                ? 'font-semibold text-foreground'
                : s < step
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
            }
          >
            {s}. {STEP_LABELS[s]}
          </span>
          {i < 3 && <span className="text-muted-foreground/30">›</span>}
        </span>
      ))}
    </nav>
  )
}

function Step1({
  name, setName, clientName, setClientName,
  startDate, setStartDate, endDate, setEndDate,
  onNext,
}: {
  name: string; setName: (s: string) => void
  clientName: string; setClientName: (s: string) => void
  startDate: string; setStartDate: (s: string) => void
  endDate: string; setEndDate: (s: string) => void
  onNext: () => void
}) {
  const canProceed = name.trim().length > 0 && clientName.trim().length > 0 && startDate.length > 0

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Identification du contrat</h2>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Nom du contrat</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          className="w-full rounded border p-2 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Client</label>
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          maxLength={200}
          className="w-full rounded border p-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Date de début</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Date de fin (optionnel)</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded border p-2 text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
        >
          Suivant
        </button>
      </div>
    </div>
  )
}

function Step2({
  engagements,
  onBack,
  onNext,
}: {
  engagements: DbEngagement[]
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <div>
        <h2 className="text-sm font-semibold">Curation des engagements ({engagements.length})</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Validez ou supprimez les engagements détectés. Vous pourrez aussi sauter cette étape et curer plus tard.
        </p>
      </div>

      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded border-dashed border p-3">
          Aucun engagement extrait. Vous pouvez continuer et créer le contrat — vous pourrez extraire les engagements plus tard depuis la page du dossier.
        </p>
      ) : (
        <EngagementCurationView engagements={engagements} />
      )}

      <div className="flex justify-between pt-2">
        <button type="button" onClick={onBack} className="px-3 py-1.5 rounded border text-sm">
          Précédent
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm"
        >
          Suivant
        </button>
      </div>
    </div>
  )
}

function Step3({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Chantiers du contrat</h2>
      <p className="text-xs text-muted-foreground">
        Les chantiers s&apos;ajoutent <strong>juste après</strong>, depuis la fiche du contrat
        (onglet <strong>Chantiers</strong>). On crée d&apos;abord le contrat, puis vous y rattachez
        ses chantiers, missions et interventions. Continuez.
      </p>
      <div className="flex justify-between pt-2">
        <button type="button" onClick={onBack} className="px-3 py-1.5 rounded border text-sm">
          Précédent
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm"
        >
          Suivant
        </button>
      </div>
    </div>
  )
}

function Step4({
  name, clientName, engagementsCount, pending, onBack, onSubmit,
}: {
  name: string
  clientName: string
  engagementsCount: number
  pending: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Récapitulatif</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Contrat :</dt>
        <dd className="font-medium">{name}</dd>
        <dt className="text-muted-foreground">Client :</dt>
        <dd className="font-medium">{clientName}</dd>
        <dt className="text-muted-foreground">Engagements à activer :</dt>
        <dd className="font-medium">{engagementsCount}</dd>
      </dl>

      <p className="text-xs text-muted-foreground rounded border-dashed border p-3">
        À la création du contrat, les engagements en status <code>extracted</code> ou <code>curated</code>
        passeront automatiquement en status <code>active</code> et seront rattachés au contrat.
      </p>

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
        >
          {pending ? 'Création…' : 'Créer le contrat'}
        </button>
      </div>
    </div>
  )
}
