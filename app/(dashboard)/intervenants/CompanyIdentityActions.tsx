'use client'

// ── IDENTITÉ ENTREPRISE — Renommer / Fusionner avec… (P0-INT-1) ────────────────
// Seule surface produit qui invoque setCompanyAlias/updateCompany (jusqu'ici la
// seule fusion existante — Clim'Expair→Clim Exp'Air — avait été faite par script
// SQL manuel, hors produit). Geste humain explicite, jamais un rapprochement
// automatique : la recherche ne propose que des noms, jamais un score de
// similarité, et fusionner exige de choisir la cible dans la liste.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Merge, Search, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CompanySearchHit } from '@/lib/db/companies'
import { renameCompanyAction, searchCompanyMergeTargetsAction, declareCompanyAliasAction } from './company-identity-actions'

type Mode = 'renommer' | 'fusionner' | null

export function CompanyIdentityActions({ companyId, companyName }: { companyId: string; companyName: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [pending, startTransition] = useTransition()
  const [nom, setNom] = useState(companyName)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CompanySearchHit[]>([])
  const [searching, startSearch] = useTransition()
  const [target, setTarget] = useState<CompanySearchHit | null>(null)

  const fermer = () => { setMode(null); setNom(companyName); setQuery(''); setHits([]); setTarget(null) }

  const renommer = () => {
    const v = nom.trim()
    if (!v || pending) return
    startTransition(async () => {
      const res = await renameCompanyAction({ companyId, name: v })
      if (res.ok) { toast.success('Entreprise renommée.'); fermer(); router.refresh() }
      else toast.error(res.error ?? 'Renommage impossible')
    })
  }

  const rechercher = (value: string) => {
    setQuery(value); setTarget(null)
    if (value.trim().length < 2) { setHits([]); return }
    startSearch(async () => {
      const res = await searchCompanyMergeTargetsAction({ companyId, query: value })
      if (res.ok) setHits(res.hits)
    })
  }

  const fusionner = () => {
    if (!target || pending) return
    startTransition(async () => {
      const res = await declareCompanyAliasAction({ companyId, canonicalCompanyId: target.id })
      if (res.ok) {
        toast.success(`« ${companyName} » est désormais un alias de « ${target.name} ».`)
        fermer()
        router.push('/intervenants')
        router.refresh()
      } else toast.error(res.error ?? 'Fusion impossible')
    })
  }

  return (
    <section className="mt-3 space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Identité de l’entreprise</p>

      {mode === null && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setMode('renommer')} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-muted">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Renommer
          </button>
          <button type="button" onClick={() => setMode('fusionner')} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
            <Merge className="h-3.5 w-3.5" aria-hidden /> Fusionner avec…
          </button>
        </div>
      )}

      {mode === 'renommer' && (
        <div className="space-y-1.5">
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            autoFocus
            placeholder="Nom de l’entreprise"
            className="w-full rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[13px]"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending || !nom.trim() || nom.trim() === companyName}
              onClick={renommer}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              Renommer
            </button>
            <button type="button" disabled={pending} onClick={fermer} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === 'fusionner' && !target && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            « {companyName} » deviendra un alias de l’entreprise choisie — ses chantiers, contacts et
            actions restent rattachés, plus rien n’est perdu, mais elle ne sera plus consultable seule.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => rechercher(e.target.value)}
              placeholder="Rechercher l’entreprise canonique…"
              className="w-full bg-transparent text-[12.5px] outline-none"
            />
          </div>
          {searching && <p className="text-[11px] text-muted-foreground">Recherche…</p>}
          {query.trim().length >= 2 && !searching && hits.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Aucune autre entreprise trouvée.</p>
          )}
          <ul className="space-y-1">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => setTarget(h)}
                  className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-left text-[12.5px] hover:border-brand-300"
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{h.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={fermer} className="text-[11.5px] text-muted-foreground hover:underline">Annuler</button>
        </div>
      )}

      {mode === 'fusionner' && target && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            Confirmer : « {companyName} » devient un alias de « <b>{target.name}</b> ». Réversible, mais
            « {companyName} » ne sera plus accessible comme entreprise indépendante.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={fusionner}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Merge className="h-3.5 w-3.5" aria-hidden />}
              Confirmer la fusion
            </button>
            <button type="button" disabled={pending} onClick={() => setTarget(null)} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted">
              Changer la cible
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
