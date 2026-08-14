'use client'

// ── D2 (P0-3D) — LES GESTES D'IDENTITÉ SUR UNE PARTICIPATION CONFIRMÉE ───────
//
// « Jean seul → ajouter EEC plus tard » sans nouvelle mention : la connaissance
// progresse sans attendre que l'IA redétecte quelque chose.
//
// DEUX FAMILLES DE GESTES, VOLONTAIREMENT SÉPARÉES :
//   · Préciser (personne / entreprise) — ENRICHIT la même participation :
//     l'identité se complète, rien n'est recréé, l'affiliation datée s'écrit.
//   · Remplacer par… — le MONDE a changé : clôture la participation actuelle,
//     en ouvre une nouvelle, et les chaîne (replaced_by_intervenant_id).
//     Jean n'est pas « corrigé » : son passage reste vrai historiquement.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, UserPlus, Building2, ArrowRightLeft, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { todayLocalIso } from '@/lib/time/local-date'
import { preciserIntervenantAction, remplacerIntervenantAction, retirerIntervenantAction } from './intervenants-actions'

export function IntervenantIdentityActions({
  siteId,
  intervenantId,
  personKnown,
  companyKnown,
  role,
}: {
  siteId: string
  intervenantId: string
  personKnown: boolean
  companyKnown: boolean
  role: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [mode, setMode] = useState<'personne' | 'entreprise' | 'remplacer' | 'retirer' | null>(null)
  const [valeur, setValeur] = useState('')
  const [remplPersonne, setRemplPersonne] = useState('')
  const [remplEntreprise, setRemplEntreprise] = useState('')
  const [remplDate, setRemplDate] = useState(todayLocalIso())
  const [retirerDate, setRetirerDate] = useState(todayLocalIso())

  const fermer = () => { setMode(null); setValeur(''); setRemplPersonne(''); setRemplEntreprise('') }

  const preciser = async (champ: 'personne' | 'entreprise') => {
    const v = valeur.trim()
    if (!v || pending) return
    setPending(true)
    const res = await preciserIntervenantAction({
      site_id: siteId,
      intervenant_id: intervenantId,
      person_name: champ === 'personne' ? v : undefined,
      company_name: champ === 'entreprise' ? v : undefined,
    })
    setPending(false)
    if (res.ok) {
      toast.success(`${v} — participation précisée.`)
      fermer()
      router.refresh()
    } else toast.error(res.error)
  }

  const remplacer = async () => {
    if (pending) return
    if (!remplPersonne.trim() && !remplEntreprise.trim()) {
      toast.error('Indiquez qui reprend le rôle (personne ou entreprise).')
      return
    }
    setPending(true)
    const res = await remplacerIntervenantAction({
      site_id: siteId,
      intervenant_id: intervenantId,
      person_name: remplPersonne.trim() || undefined,
      company_name: remplEntreprise.trim() || undefined,
      effective_date: remplDate,
    })
    setPending(false)
    if (res.ok) {
      toast.success('Remplacement enregistré — l’historique est conservé et chaîné.')
      fermer()
      router.refresh()
    } else toast.error(res.error)
  }

  const retirer = async () => {
    if (pending) return
    setPending(true)
    const res = await retirerIntervenantAction({
      site_id: siteId,
      intervenant_id: intervenantId,
      effective_date: retirerDate,
    })
    setPending(false)
    if (res.ok) {
      toast.success('Intervenant retiré — son passage reste dans l’historique.')
      fermer()
      router.refresh()
    } else toast.error(res.error)
  }

  return (
    <section className="mt-3 space-y-2 rounded-xl border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Préciser l’intervenant
      </p>

      {mode === null && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setMode('personne')}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-muted"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {personKnown ? 'Changer la personne' : 'Préciser la personne'}
          </button>
          <button
            type="button"
            onClick={() => setMode('entreprise')}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-muted"
          >
            <Building2 className="h-3.5 w-3.5" />
            {companyKnown ? 'Changer l’entreprise' : 'Préciser l’entreprise'}
          </button>
          {/* Remplacer = ÉVOLUTION TEMPORELLE, visuellement séparé des
              enrichissements : il ne corrige pas, il raconte un changement. */}
          <button
            type="button"
            onClick={() => setMode('remplacer')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Remplacer par…
          </button>
          {/* Retirer = FIN DE MISSION, pas une erreur : « il n'intervient plus »
              se distingue de « il n'a jamais été intervenant » (doctrine F). */}
          <button
            type="button"
            onClick={() => setMode('retirer')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" /> Retirer
          </button>
        </div>
      )}

      {(mode === 'personne' || mode === 'entreprise') && (
        <div className="space-y-1.5">
          <input
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            autoFocus
            placeholder={mode === 'personne' ? 'Rechercher ou ajouter — Prénom Nom' : 'Rechercher ou ajouter une entreprise'}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <p className="text-[11px] text-muted-foreground">
            La participation actuelle est enrichie — rien n’est recréé, les preuves historiques restent intactes.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending || !valeur.trim()}
              onClick={() => preciser(mode)}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Préciser
            </button>
            <button type="button" disabled={pending} onClick={fermer} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === 'remplacer' && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            Qui reprend le rôle « {role} » ? La participation actuelle sera clôturée à la date
            choisie, la nouvelle chaînée — l’historique reste lisible.
          </p>
          <input
            value={remplPersonne}
            onChange={(e) => setRemplPersonne(e.target.value)}
            placeholder="Personne (facultatif)"
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <input
            value={remplEntreprise}
            onChange={(e) => setRemplEntreprise(e.target.value)}
            placeholder="Entreprise (facultatif)"
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <input
            type="date"
            value={remplDate}
            onChange={(e) => setRemplDate(e.target.value)}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={remplacer}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
              Remplacer
            </button>
            <button type="button" disabled={pending} onClick={fermer} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === 'retirer' && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            « {role} » n’intervient plus sur ce chantier à partir de quelle date ? La participation
            est clôturée — son passage reste dans l’historique, rien n’est supprimé.
          </p>
          <input
            type="date"
            value={retirerDate}
            onChange={(e) => setRetirerDate(e.target.value)}
            className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px]"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={retirer}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Retirer
            </button>
            <button type="button" disabled={pending} onClick={fermer} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
