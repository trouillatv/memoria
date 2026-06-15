'use client'

// « Nouvelle réunion » depuis le cockpit /meetings.
// Étape 1 : choisir le niveau (réunion contrat = multi-sites, ou réunion site).
// Étape 2 : choisir l'entité concernée.
// Étape 3 : ouvrir le SiteReportPanel existant (capture → IA → curation).
// On réutilise tel quel le moteur compte-rendu ; ici on n'ajoute que la porte.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Building2, MapPin, ArrowLeft, X } from 'lucide-react'
import { SiteReportPanel } from '@/app/(field)/m/site/[siteId]/SiteReportPanel'

type Option = { id: string; name: string }
type Step = 'closed' | 'pick-type' | 'pick-contract' | 'pick-site' | 'capture'

export function NewMeetingButton({ contracts, sites }: { contracts: Option[]; sites: Option[] }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('closed')
  const [reportType, setReportType] = useState<'contract' | 'site'>('site')
  const [chosen, setChosen] = useState<Option | null>(null)
  const [query, setQuery] = useState('')

  function reset() {
    setStep('closed')
    setChosen(null)
    setQuery('')
  }

  function handleClose() {
    reset()
    router.refresh() // une réunion vient peut-être d'être créée
  }

  const list = step === 'pick-contract' ? contracts : sites
  const filteredList = query.trim()
    ? list.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : list

  return (
    <>
      <button
        type="button"
        onClick={() => setStep('pick-type')}
        className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-transform active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" /> Nouvelle réunion
      </button>

      {step !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-3 sm:p-6">
          <div className="w-full max-w-lg rounded-xl border bg-card p-4 shadow-lg my-2">
            {/* En-tête modal */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {(step === 'pick-contract' || step === 'pick-site') && (
                  <button type="button" onClick={() => setStep('pick-type')} aria-label="Retour"
                    className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <h2 className="text-sm font-semibold">
                  {step === 'pick-type' && 'Nouvelle réunion'}
                  {step === 'pick-contract' && 'Réunion de contrat'}
                  {step === 'pick-site' && 'Réunion de site'}
                  {step === 'capture' && (reportType === 'contract' ? 'Réunion de contrat' : 'Réunion de site')}
                </h2>
              </div>
              <button type="button" onClick={handleClose} aria-label="Fermer"
                className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Étape 1 — niveau */}
            {step === 'pick-type' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => { setReportType('contract'); setStep('pick-contract') }}
                  className="w-full text-left rounded-lg border p-3 hover:border-foreground/40 hover:bg-muted/20 transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Building2 className="h-4 w-4 text-violet-600" /> Réunion de contrat
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Une réunion (ex. lundi matin) qui couvre plusieurs sites d&apos;un même contrat.
                    L&apos;IA route chaque décision vers le bon site ; vous confirmez.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => { setReportType('site'); setStep('pick-site') }}
                  className="w-full text-left rounded-lg border p-3 hover:border-foreground/40 hover:bg-muted/20 transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <MapPin className="h-4 w-4 text-sky-600" /> Réunion de site
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Un point sur un seul site. Tout est rattaché à ce site.
                  </p>
                </button>
              </div>
            )}

            {/* Étape 2 — entité */}
            {(step === 'pick-contract' || step === 'pick-site') && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  placeholder={step === 'pick-contract' ? 'Rechercher un contrat…' : 'Rechercher un site…'}
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
                />
                <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
                  {filteredList.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground italic">Aucun résultat.</p>
                  ) : (
                    filteredList.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setChosen(o); setStep('capture') }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors active:bg-muted/60"
                      >
                        {o.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Étape 3 — capture (moteur compte-rendu existant) */}
            {step === 'capture' && chosen && (
              <SiteReportPanel
                reportType={reportType}
                siteId={reportType === 'site' ? chosen.id : undefined}
                siteName={reportType === 'site' ? chosen.name : undefined}
                contractId={reportType === 'contract' ? chosen.id : undefined}
                contractName={reportType === 'contract' ? chosen.name : undefined}
                onClose={handleClose}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
