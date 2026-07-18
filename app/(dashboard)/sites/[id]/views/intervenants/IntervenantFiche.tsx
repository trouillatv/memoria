'use client'

// ── LA FICHE INTERVENANT — l'objet transverse du produit ─────────────────────
// « La fiche est LE produit ; l'onglet n'est qu'une porte parmi d'autres »
// (Vincent, 2026-07-18). Ce composant est la MÊME fiche partout : onglet
// Intervenants, Explorer, recherche, objets métier. Un seul composant, un seul
// apprentissage. Il répond à « c'était qui déjà ? » en 20 secondes — pas une
// fiche de gestion : coordonnées repliées, jamais au premier niveau.
//
// Présentationnel pur : il reçoit un IntervenantPerson déjà calculé (read model
// site-intervenants-view). Il n'invente aucune information — chaque phrase est
// composée de faits datés et sourcés.

import Link from 'next/link'
import { Check, ChevronRight, Network, Phone } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { frDayMonthLocal } from '@/lib/time/local-date'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'

export function IntervenantFicheSheet({ siteId, person, onClose }: {
  siteId: string
  person: IntervenantPerson | null
  onClose: () => void
}) {
  if (!person) return null
  const p = person

  // Une phrase DÉTERMINISTE, composée de faits — jamais un texte inventé.
  const phrase = p.isPerson
    ? `${p.fonction ?? 'Interlocuteur'} ${p.companyName} — rôle ${p.role} sur ce chantier.`
    : `Entreprise du chantier — rôle ${p.role}.`
  const provenance = p.citedVisits.length > 0
    ? `D’après ${p.citedVisits.length} visite${p.citedVisits.length > 1 ? 's' : ''} et le casting du chantier.`
    : 'D’après le casting du chantier.'

  const timeline: Array<{ date: string | null; label: string }> = [
    ...p.citedVisits.slice(0, 2).map((v) => ({ date: v.date, label: 'Cité pendant cette visite' })),
    { date: p.firstSeen, label: 'Première apparition dans la mémoire' },
  ]

  const infos: Array<[string, string]> = []
  if (p.phone) infos.push(['Téléphone', p.phone])
  if (p.mobile) infos.push(['Mobile', p.mobile])
  if (p.email) infos.push(['Mail', p.email])

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-0">
          <SheetTitle className="text-base font-semibold">{p.name}</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            {[p.companyName, p.fonction ?? `Rôle ${p.role}`].filter(Boolean).join(' · ')}
          </p>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">En une phrase</h4>
            <p className="mt-1 text-[13.5px]">{phrase}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground/80">{provenance}</p>
          </section>

          {p.openActions > 0 && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Aujourd’hui</h4>
              <p className="mt-1 text-[13px]">
                <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                {p.openActions} action{p.openActions > 1 ? 's' : ''} ouverte{p.openActions > 1 ? 's' : ''} pour {p.role}
              </p>
            </section>
          )}

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pourquoi {p.isPerson ? 'est-il ici' : 'est-elle ici'} ?
            </h4>
            <p className="mt-1 text-[13.5px]">
              {p.citedVisits.length > 0
                ? `Cité${p.isPerson ? '' : 'e'} dans ${p.citedVisits.length} visite${p.citedVisits.length > 1 ? 's' : ''} de ce chantier, et confirmé${p.isPerson ? '' : 'e'} par un humain.`
                : 'Ajouté au casting du chantier par un humain.'}
            </p>
          </section>

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Dernières activités</h4>
            <ul className="mt-2 space-y-2 border-l-2 pl-3">
              {timeline.map((t, i) => (
                <li key={i} className="text-[13px]">
                  <span className="block text-[12px] text-muted-foreground">
                    {t.date ? frDayMonthLocal(t.date) : '—'}
                  </span>
                  {t.label}
                </li>
              ))}
            </ul>
          </section>

          {p.elsewhere.length > 0 && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ailleurs</h4>
              <ul className="mt-1 space-y-1">
                {p.elsewhere.slice(0, 4).map((e) => (
                  <li key={e.siteId} className="text-[13px]">
                    <Link href={`/sites/${e.siteId}?tab=intervenants`} className="hover:underline">
                      {e.siteName}
                    </Link>
                    <span className="text-muted-foreground"> — rôle {e.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Coordonnées REPLIÉES : la fiche est narrative, pas un CRM. */}
          {infos.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Informations
              </summary>
              <ul className="mt-1 space-y-1">
                {infos.map(([k, v]) => (
                  <li key={k} className="text-[13px]">
                    <span className="text-muted-foreground">{k}</span> · {v}
                    {(k === 'Téléphone' || k === 'Mobile') && (
                      <a href={`tel:${v.replace(/\s/g, '')}`} className="ml-2 text-primary">
                        <Phone className="inline h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Link
            href={`/sites/${siteId}?tab=explorer`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-muted"
          >
            <Network className="h-4 w-4" /> Voir dans Explorer
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
