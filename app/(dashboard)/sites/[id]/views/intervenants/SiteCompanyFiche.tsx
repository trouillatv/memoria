'use client'

// ── LA FICHE ENTREPRISE (site-scope) — Lot 3 Intervenants ────────────────────
// Mandat Vincent 2026-09-14 : « Le vrai "wow" de cette page ne sera pas
// graphique. Ce sera que David clique Clim Exp'Air et retrouve enfin une seule
// histoire cohérente au lieu de quatre lignes sans activité. » Quatre blocs
// fixes, aucun de plus : À faire / Points / Présence chantier / Contacts.
//
// Présentationnel pur : reçoit un ConsolidatedIntervenant déjà agrégé par
// entreprise canonique (Lot 2A/2B). N'invente rien — « Points où citée » reste
// hors scope tant que ce read-model n'existe pas (cf. site-intervenants-consolidated.ts).

import Link from 'next/link'
import { ListChecks, Layers, Users, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheSection, FicheRow, FicheLinkRow, FicheEmpty, CompanyAvatar } from '@/app/(dashboard)/intervenants/fiche-ui'
import { garderContexte } from '../fiche-segment-href'
import { frDayMonthLocal } from '@/lib/time/local-date'
import type { ConsolidatedIntervenant } from '@/lib/knowledge/site-intervenants-consolidated'

// Tints de section — mêmes couleurs que les KPI d'IntervenantsLeaderboard,
// pour un langage visuel cohérent entre la liste et le drawer.
const TINT_ACTIONS = '#6366f1'
const TINT_ENGAGEMENTS = '#f59e0b'
const TINT_PRESENCE = '#10b981'
const TINT_CONTACTS = '#64748b'

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function SiteCompanyFicheBody({ company, variant = 'panel', search = '' }: {
  company: ConsolidatedIntervenant
  variant?: 'panel' | 'page'
  /** Suivre une relation ne change pas le décor (cf. IntervenantFiche.tsx) : le
   *  panneau appelant fournit la query courante via `garderContexte`. */
  search?: string
}) {
  const c = company
  const roles = [...new Set(c.casting.map((r) => formatRole(r.role)))]
  const withContext = (href: string) => garderContexte(href, search) ?? href

  return (
    <>
      <SheetHeader className="pb-0">
        <div className="flex items-center gap-2.5">
          <CompanyAvatar name={c.companyName} companyId={c.companyId} />
          <div className="min-w-0">
            {variant === 'page'
              ? <h1 className="truncate text-base font-semibold">{c.companyName}</h1>
              : <SheetTitle className="truncate text-base font-semibold">{c.companyName}</SheetTitle>}
            <p className="text-[13px] text-muted-foreground">
              {roles.length > 0 ? roles.join(' · ') : 'Rôle non précisé'}
            </p>
          </div>
        </div>
        {c.mergedCompanyIds.length > 0 && (
          <p className="mt-1 text-[11.5px] text-muted-foreground/80">
            Réunit {c.mergedCompanyIds.length} doublon{c.mergedCompanyIds.length > 1 ? 's' : ''} de nom déjà identifié{c.mergedCompanyIds.length > 1 ? 's' : ''}.
          </p>
        )}
      </SheetHeader>

      <div className="space-y-4 px-4 pb-6">
        <FicheSection title="À faire" count={c.actions.length} icon={<ListChecks className="h-3.5 w-3.5" />} tint={TINT_ACTIONS} emphasis>
          {c.actions.length === 0 ? (
            <FicheEmpty>Aucune action ouverte sur ce chantier.</FicheEmpty>
          ) : (
            c.actions.map((a) => (
              <FicheLinkRow
                key={a.id}
                href={withContext(a.href)}
                icon="→"
                label={a.title}
                sub={a.dueDate ? (
                  <span className={cn(a.overdue && 'font-medium text-rose-600 dark:text-rose-400')}>
                    {a.overdue ? 'En retard depuis le ' : 'Échéance le '}{frDayMonthLocal(a.dueDate)}
                  </span>
                ) : undefined}
              />
            ))
          )}
        </FicheSection>

        {/* Recette Vincent 2026-09-15 : trois blocs vides à la suite donnaient
            l'impression de « descendre dans du vide ». On ne déploie une
            section Décisions/Obligations/Points que si elle a du contenu ;
            sinon un seul bloc compact regroupe les trois constats. */}
        {c.decisions.length > 0 && (
          <FicheSection title="Décisions" count={c.decisions.length} icon={<Layers className="h-3.5 w-3.5" />} tint={TINT_ENGAGEMENTS}>
            {c.decisions.map((d) => (
              <FicheLinkRow key={d.id} href={withContext(d.href)} icon="⚑" label={d.titre} />
            ))}
          </FicheSection>
        )}

        {c.openObligationsCount > 0 && (
          <FicheSection title="Obligations" count={c.openObligationsCount} icon={<Layers className="h-3.5 w-3.5" />} tint={TINT_ENGAGEMENTS}>
            <FicheRow icon="▤" label={`${c.openObligationsCount} obligation${c.openObligationsCount > 1 ? 's' : ''} ouverte${c.openObligationsCount > 1 ? 's' : ''}`}
              sub="Pas encore de fiche dédiée — compte uniquement." />
          </FicheSection>
        )}

        {c.pointsPiloted.length > 0 && (
          <FicheSection title="Points" count={c.pointsPiloted.length} icon={<MapPin className="h-3.5 w-3.5" />} tint={TINT_PRESENCE}>
            {c.pointsPiloted.map((p) => (
              <FicheLinkRow key={p.id} href={withContext(p.href)} icon="●" label={p.label}
                sub={`Désigné responsable le ${frDayMonthLocal(p.designatedAt)}`} />
            ))}
          </FicheSection>
        )}

        {c.decisions.length === 0 && c.openObligationsCount === 0 && c.pointsPiloted.length === 0 && (
          <FicheSection title="Autres engagements" icon={<Layers className="h-3.5 w-3.5" />} tint={TINT_ENGAGEMENTS}>
            <FicheEmpty>Aucune décision · aucune obligation · aucun Point piloté.</FicheEmpty>
          </FicheSection>
        )}

        <FicheSection title="Présence chantier" count={c.casting.length} icon={<MapPin className="h-3.5 w-3.5" />} tint={TINT_PRESENCE}>
          {c.casting.length === 0 ? (
            <FicheEmpty>Aucun casting connu sur ce chantier.</FicheEmpty>
          ) : (
            c.casting.map((cast) => (
              <FicheRow key={cast.id} icon="◆" label={formatRole(cast.role)}
                sub={cast.effectiveFrom
                  ? `Depuis le ${frDayMonthLocal(cast.effectiveFrom)}${cast.effectiveTo ? ` jusqu'au ${frDayMonthLocal(cast.effectiveTo)}` : ' · en cours'}`
                  : undefined} />
            ))
          )}
        </FicheSection>

        <FicheSection title="Contacts" count={c.contacts.length} icon={<Users className="h-3.5 w-3.5" />} tint={TINT_CONTACTS}>
          {c.contacts.length === 0 ? (
            <FicheEmpty>Aucun contact structuré rattaché à cette entreprise.</FicheEmpty>
          ) : (
            c.contacts.map((contact) => (
              <FicheLinkRow key={contact.id} href={withContext(contact.href)} icon="＠" label={contact.name}
                sub={[contact.function, contact.actionsCount > 0 ? `${contact.actionsCount} action${contact.actionsCount > 1 ? 's' : ''} portée${contact.actionsCount > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || undefined} />
            ))
          )}
        </FicheSection>

        <Link
          href={`/intervenants/entreprise/${c.companyId}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline"
        >
          Voir la fiche entreprise complète (tous chantiers) →
        </Link>
      </div>
    </>
  )
}
