'use client'

// Sprint 3 — UX-8 Mode litige express : wizard client.
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - 1 action visible à chaque étape (mono-tâche).
//   - Gros boutons lisibles, pas de pollution visuelle.
//   - Wording strictement passif :
//       « Quel site est concerné ? »
//       « Sur quelle période ? »
//       « Que voulez-vous inclure ? »
//       « Dossier prêt »
//   - Aucun mot interdit : pas de "ALERTE", "URGENT", "Score", etc.
//
// State : useState pour les 4 étapes + données saisies.

import * as React from 'react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronRight, ChevronLeft, Download, Share2, Loader2 } from 'lucide-react'
import {
  prepareLitigeDossierAction,
  type PrepareLitigeDossierCounts,
} from './actions'
import { ConfidenceLevel } from './ConfidenceLevel'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface ContractOption {
  id: string
  name: string
  client_name: string
}

interface SiteOption {
  id: string
  name: string
}

interface LitigeWizardProps {
  contracts: ContractOption[]
  sites: SiteOption[]
}

type Step = 1 | 2 | 3 | 4

type PeriodChoice = 'yesterday' | 'thisWeek' | 'custom'

interface ReadyResult {
  pdfUrl?: string
  shareUrl?: string
  expiresAt?: string
  counts: PrepareLitigeDossierCounts
}

// ----------------------------------------------------------------------------
// Helpers — bornes de période
// ----------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function yesterdayBounds(): { from: string; to: string } {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const iso = toIsoDate(d)
  return { from: iso, to: iso }
}

function thisWeekBounds(): { from: string; to: string } {
  // Lundi → aujourd'hui (cadence locale FR).
  const today = new Date()
  const dow = today.getDay() // 0=dim, 1=lun, ...
  const offsetToMonday = (dow + 6) % 7 // 0 si lundi, 6 si dim
  const monday = new Date(today)
  monday.setDate(today.getDate() - offsetToMonday)
  return { from: toIsoDate(monday), to: toIsoDate(today) }
}

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------

export function LitigeWizard({ contracts, sites }: LitigeWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [contractId, setContractId] = useState<string>('')
  const [siteId, setSiteId] = useState<string>('')
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice | null>(null)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [includeInterventions, setIncludeInterventions] = useState(true)
  const [includePhotos, setIncludePhotos] = useState(true)
  const [includeAnomalies, setIncludeAnomalies] = useState(true)
  const [includeValidations, setIncludeValidations] = useState(true)
  const [submitting, startTransition] = useTransition()
  const [result, setResult] = useState<ReadyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function computePeriod(): { from: string; to: string } | null {
    if (periodChoice === 'yesterday') return yesterdayBounds()
    if (periodChoice === 'thisWeek') return thisWeekBounds()
    if (periodChoice === 'custom') {
      if (!customFrom || !customTo) return null
      return { from: customFrom, to: customTo }
    }
    return null
  }

  function handlePrepare() {
    const period = computePeriod()
    if ((!contractId && !siteId) || !period) return
    setError(null)
    startTransition(async () => {
      const res = await prepareLitigeDossierAction({
        contractId: contractId || undefined,
        siteId: siteId || undefined,
        dateFrom: period.from,
        dateTo: period.to,
        includeInterventions,
        includePhotos,
        includeAnomalies,
        includeValidations,
      })
      if (!res.ok) {
        setError(res.error ?? 'Erreur préparation du dossier')
        return
      }
      setResult({
        pdfUrl: res.pdfUrl,
        shareUrl: res.shareUrl,
        expiresAt: res.expiresAt,
        counts: res.counts ?? {
          interventions: 0,
          photos: 0,
          anomalies: 0,
          anomaliesResolved: 0,
          validations: 0,
        },
      })
      setStep(4)
    })
  }

  // ----------------------------------------------------------------------------
  // Render — UNE action visible à la fois.
  // ----------------------------------------------------------------------------

  return (
    <div data-testid="litige-wizard" className="space-y-6">
      {/* Indicateur d'étape sobre */}
      <StepIndicator step={step} />

      {step === 1 && (
        <StepCard title="Quel contrat est concerné ?">
          <div className="space-y-3">
            {contracts.length > 0 ? (
              <>
                <Label htmlFor="litige-contract" className="text-sm">
                  Contrat
                </Label>
                <select
                  id="litige-contract"
                  data-testid="litige-contract-select"
                  value={contractId}
                  onChange={(e) => { setContractId(e.target.value); setSiteId('') }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base"
                >
                  <option value="">— Sélectionner —</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.client_name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <Label htmlFor="litige-site" className="text-sm">
                  Site
                </Label>
                <select
                  id="litige-site"
                  data-testid="litige-site-select"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base"
                >
                  <option value="">— Sélectionner —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="flex justify-end pt-4">
            <Button
              size="lg"
              disabled={!contractId && !siteId}
              onClick={() => setStep(2)}
              data-testid="litige-step1-continue"
            >
              Continuer
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard title="Sur quelle période ?">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <PeriodButton
              label="Hier"
              selected={periodChoice === 'yesterday'}
              onClick={() => setPeriodChoice('yesterday')}
              testId="litige-period-yesterday"
            />
            <PeriodButton
              label="Cette semaine"
              selected={periodChoice === 'thisWeek'}
              onClick={() => setPeriodChoice('thisWeek')}
              testId="litige-period-thisweek"
            />
            <PeriodButton
              label="Période personnalisée"
              selected={periodChoice === 'custom'}
              onClick={() => setPeriodChoice('custom')}
              testId="litige-period-custom"
            />
          </div>

          {periodChoice === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
              <div>
                <Label htmlFor="litige-from" className="text-sm">
                  Du
                </Label>
                <Input
                  id="litige-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  data-testid="litige-custom-from"
                />
              </div>
              <div>
                <Label htmlFor="litige-to" className="text-sm">
                  Au
                </Label>
                <Input
                  id="litige-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  data-testid="litige-custom-to"
                />
              </div>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="outline" size="lg" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Retour
            </Button>
            <Button
              size="lg"
              disabled={
                !periodChoice ||
                (periodChoice === 'custom' && (!customFrom || !customTo))
              }
              onClick={() => setStep(3)}
              data-testid="litige-step2-continue"
            >
              Continuer
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </StepCard>
      )}

      {step === 3 && (
        <StepCard title="Que voulez-vous inclure ?">
          <div className="space-y-2.5">
            <CheckboxRow
              label="Interventions de la période"
              checked={includeInterventions}
              onChange={setIncludeInterventions}
            />
            <CheckboxRow
              label="Photos prises"
              checked={includePhotos}
              onChange={setIncludePhotos}
            />
            <CheckboxRow
              label="Anomalies signalées"
              checked={includeAnomalies}
              onChange={setIncludeAnomalies}
            />
            <CheckboxRow
              label="Validations"
              checked={includeValidations}
              onChange={setIncludeValidations}
            />
          </div>

          {error && (
            <p
              className="text-sm text-amber-700 mt-3"
              data-testid="litige-error"
            >
              {error}
            </p>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setStep(2)}
              disabled={submitting}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Retour
            </Button>
            <Button
              size="lg"
              onClick={handlePrepare}
              disabled={submitting}
              data-testid="litige-prepare"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Préparation…
                </>
              ) : (
                <>Préparer le dossier</>
              )}
            </Button>
          </div>
        </StepCard>
      )}

      {step === 4 && result && (
        <StepCard title="Dossier prêt">
          <p className="text-sm text-slate-700">
            {result.counts.interventions.toLocaleString('fr-FR')} intervention
            {result.counts.interventions > 1 ? 's' : ''} ·{' '}
            {result.counts.photos.toLocaleString('fr-FR')} photo
            {result.counts.photos > 1 ? 's' : ''} ·{' '}
            {result.counts.anomaliesResolved.toLocaleString('fr-FR')} anomalie
            {result.counts.anomaliesResolved > 1 ? 's' : ''} clôturée
            {result.counts.anomaliesResolved > 1 ? 's' : ''} sur la période.
          </p>

          <ConfidenceLevel
            interventionsCount={result.counts.interventions}
            photosCount={result.counts.photos}
            anomaliesCount={
              result.counts.anomalies - result.counts.anomaliesResolved
            }
            validationsCount={result.counts.validations}
          />

          {result.pdfUrl ? (
            <div className="space-y-3">
              <a
                href={result.pdfUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="litige-pdf-download"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-4 py-3 text-base font-medium hover:bg-slate-800 transition-colors"
              >
                <Download className="h-4 w-4" />
                Télécharger le PDF
              </a>

              {result.shareUrl && (
                <ShareButton shareUrl={result.shareUrl} />
              )}

              {result.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Lien valable jusqu&apos;au{' '}
                  {new Date(result.expiresAt).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Aucune intervention documentée sur cette période. Le dossier
              reste consultable depuis l&apos;historique des preuves.
            </p>
          )}
        </StepCard>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Sub-components — gros, lisibles, calmes.
// ----------------------------------------------------------------------------

function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={
            'h-1.5 flex-1 rounded-full ' +
            (n <= step ? 'bg-slate-900' : 'bg-slate-200')
          }
        />
      ))}
    </div>
  )
}

function StepCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  )
}

function PeriodButton({
  label,
  selected,
  onClick,
  testId,
}: {
  label: string
  selected: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={
        'rounded-lg border px-4 py-3 text-sm font-medium transition-colors ' +
        (selected
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
      }
    >
      {label}
    </button>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300"
      />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  )
}

function ShareButton({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false)

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Pas de toast bruyant ici — wording calme.
    }
  }

  // Deep link WhatsApp (ouvre WhatsApp avec le lien pré-rempli si disponible).
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareUrl)}`

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <button
        type="button"
        onClick={copyToClipboard}
        data-testid="litige-share-copy"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <Share2 className="h-4 w-4" />
        {copied ? 'Lien copié' : 'Copier le lien'}
      </button>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noreferrer"
        data-testid="litige-share-whatsapp"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
      >
        Partager via WhatsApp
      </a>
    </div>
  )
}
