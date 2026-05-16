'use client'

import { useState, useTransition, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, AlertTriangle, ExternalLink, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import {
  createSiteGlobalAction,
  type SimilarSiteResult,
} from './actions'
import {
  SiteExtendedFields,
  emptySiteExtendedState,
  applySiteExtendedToFormData,
} from './SiteExtendedFields'
import type { ClientLite, ContractLite, SiteForMatching } from '@/lib/db/sites'

// ---------------------------------------------------------------------------
// Similarité trigram côté client — même algorithme que le serveur.
// Évite un round-trip pour le feedback live pendant la saisie.
// ---------------------------------------------------------------------------
function buildTrigrams(s: string): Set<string> {
  const padded = ` ${s} `
  const t = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) t.add(padded.slice(i, i + 3))
  return t
}

function trigramSim(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = buildTrigrams(a)
  const tb = buildTrigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const g of ta) if (tb.has(g)) inter++
  return (2 * inter) / (ta.size + tb.size)
}

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------

interface Props {
  clients: ClientLite[]
  contracts: ContractLite[]
  allSites: SiteForMatching[]
}

type DialogStep = 'closed' | 'form' | 'dup_warning'

const INPUT = 'w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50'
const SELECT = 'w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 appearance-none'

export function CreateSiteDialog({ clients, contracts, allSites }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<DialogStep>('closed')
  const [pending, startTransition] = useTransition()

  // Champs du formulaire
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientNameNew, setClientNameNew] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [contractId, setContractId] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [extended, setExtended] = useState(emptySiteExtendedState())

  // Similarité live
  const [liveSimilar, setLiveSimilar] = useState<SiteForMatching[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Résultat du warning serveur
  const [serverSimilar, setServerSimilar] = useState<SimilarSiteResult[]>([])

  function reset() {
    setName(''); setClientId(''); setClientNameNew(''); setShowNewClient(false)
    setContractId(''); setAddress(''); setNotes('')
    setExtended(emptySiteExtendedState())
    setLiveSimilar([]); setServerSimilar([])
  }

  function close() { setStep('closed'); reset() }

  // Calcul live de similarité à chaque frappe (debounce 300ms)
  const handleNameChange = useCallback((value: string) => {
    setName(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const normalized = normalizeName(value)
      if (normalized.length < 3) { setLiveSimilar([]); return }
      const matches = allSites
        .map((s) => ({ ...s, _score: trigramSim(s.normalized_name, normalized) }))
        .filter((s) => s._score >= 0.75)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
      setLiveSimilar(matches)
    }, 300)
  }, [allSites])

  async function submit(force: boolean) {
    const fd = new FormData()
    fd.set('name', name.trim())
    if (showNewClient) {
      fd.set('client_name_new', clientNameNew.trim())
    } else {
      fd.set('client_id', clientId)
    }
    if (contractId) fd.set('contract_id', contractId)
    if (address.trim()) fd.set('address', address.trim())
    if (notes.trim()) fd.set('notes', notes.trim())
    fd.set('force', force ? 'true' : 'false')
    applySiteExtendedToFormData(fd, extended)

    startTransition(async () => {
      const result = await createSiteGlobalAction(fd)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if ('similar' in result) {
        setServerSimilar(result.similar)
        setStep('dup_warning')
        return
      }
      toast.success('Site créé')
      close()
      router.refresh()
      router.push(`/sites/${result.siteId}`)
    })
  }

  const canSubmit =
    name.trim().length > 0 &&
    (showNewClient ? clientNameNew.trim().length > 0 : clientId.length > 0)

  // -------------------------------------------------------------------------
  if (step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStep('form')}
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Nouveau site
      </button>
    )
  }

  // -------------------------------------------------------------------------
  // Overlay modal
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm overflow-y-auto py-8 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="relative w-full max-w-lg rounded-xl border bg-card shadow-lg">
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b">
          <h2 className="text-base font-semibold">
            {step === 'dup_warning' ? 'Sites similaires détectés' : 'Nouveau site'}
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 hover:bg-muted/50"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Étape 1 : formulaire */}
        {/* ----------------------------------------------------------------- */}
        {step === 'form' && (
          <div className="px-5 py-5 space-y-4">

            {/* Nom du site */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nom du site *</label>
              <input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className={INPUT}
                maxLength={200}
                placeholder="ex. CHT Bloc A, Dumbéa Mall RDC…"
                disabled={pending}
                autoFocus
              />

              {/* Similarité live */}
              {liveSimilar.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Sites similaires déjà enregistrés
                  </div>
                  <ul className="space-y-1">
                    {liveSimilar.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-amber-900">
                          <span className="font-medium">{s.name}</span>
                          {s.client_display_name && (
                            <span className="text-amber-700/70 ml-1">— {s.client_display_name}</span>
                          )}
                        </span>
                        <a
                          href={`/sites/${s.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 hover:text-amber-900 shrink-0"
                        >
                          Voir <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-amber-700/80">
                    Vérifiez qu&apos;il s&apos;agit bien d&apos;un nouveau site avant de continuer.
                  </p>
                </div>
              )}
            </div>

            {/* Client */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Client *</label>
              {!showNewClient ? (
                <div className="space-y-1.5">
                  <div className="relative">
                    <select
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className={SELECT}
                      disabled={pending}
                    >
                      <option value="">— Sélectionner un client —</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowNewClient(true); setClientId('') }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    disabled={pending}
                  >
                    + Nouveau client
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    value={clientNameNew}
                    onChange={(e) => setClientNameNew(e.target.value)}
                    className={INPUT}
                    maxLength={200}
                    placeholder="Nom du client (ex. CHT, OPT, Dumbéa…)"
                    disabled={pending}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setShowNewClient(false); setClientNameNew('') }}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    disabled={pending}
                  >
                    ← Choisir un client existant
                  </button>
                </div>
              )}
            </div>

            {/* Contrat (optionnel) */}
            {contracts.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Contrat <span className="font-normal text-muted-foreground/70">(optionnel)</span>
                </label>
                <div className="relative">
                  <select
                    value={contractId}
                    onChange={(e) => setContractId(e.target.value)}
                    className={SELECT}
                    disabled={pending}
                  >
                    <option value="">— Aucun contrat pour l&apos;instant —</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.client_name ? ` (${c.client_name})` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Le site peut exister sans contrat — il survivra aux contrats futurs.
                </p>
              </div>
            )}

            {/* Adresse */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Adresse</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={INPUT}
                maxLength={500}
                placeholder="Rue, ville, Nouvelle-Calédonie"
                disabled={pending}
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={INPUT}
                rows={2}
                maxLength={2000}
                disabled={pending}
              />
            </div>

            {/* Champs pratiques repliables */}
            <SiteExtendedFields
              state={extended}
              onChange={(patch) => setExtended((s) => ({ ...s, ...patch }))}
              disabled={pending}
            />

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={pending || !canSubmit}
                className="px-4 py-1.5 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50 transition-opacity"
              >
                {pending ? 'Création…' : 'Créer le site'}
              </button>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Étape 2 : confirmation doublon */}
        {/* ----------------------------------------------------------------- */}
        {step === 'dup_warning' && (
          <div className="px-5 py-5 space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  Des sites au nom similaire à <strong>{name}</strong> existent déjà.
                  Vérifiez qu&apos;il s&apos;agit bien d&apos;un nouveau site distinct.
                </p>
              </div>
              <ul className="space-y-1.5">
                {serverSimilar.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-medium text-amber-900">{s.name}</span>
                      {s.client_display_name && (
                        <span className="text-xs text-amber-700/80 ml-1.5">— {s.client_display_name}</span>
                      )}
                      <span className="text-[10px] text-amber-600 ml-1.5">
                        ({Math.round(s.score * 100)}% similaire)
                      </span>
                    </div>
                    <a
                      href={`/sites/${s.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 shrink-0 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100 transition-colors"
                    >
                      Voir le site <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm text-muted-foreground">
              Si ce site est distinct des autres (zone différente, bâtiment séparé…),
              vous pouvez le créer quand même. La mémoire IA sera indépendante pour chaque site.
            </p>

            <div className="flex justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={pending}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
              >
                ← Modifier le nom
              </button>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={pending}
                className="px-4 py-1.5 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50 transition-opacity"
              >
                {pending ? 'Création…' : 'Créer quand même'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
