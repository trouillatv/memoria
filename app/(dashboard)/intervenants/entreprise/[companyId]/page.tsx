// Fiche ENTREPRISE (Lot 2B.3B) — surface de LECTURE d'une entreprise (companies).
// Ordre imposé : Situation actuelle → Présence opérationnelle → Contacts → Travail en
// cours → Historique. Carte de synthèse en tête (« pourquoi cette entreprise ? » en
// < 5 s). Le VOLUME seul ne dégrade jamais l'état. Statut par chantier, pas de raccourci
// global. Garde d'accès : kill-switch + privilégié. Liens vers les surfaces propriétaires.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, MapPin, User, ArrowRight, Clock, Mail, Phone, Globe } from 'lucide-react'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getCompanyFiche, type CompanyFiche } from '@/lib/db/company-fiche'
import { AttentionBadge, FicheSection, FicheLinkRow, FicheEmpty } from '../../fiche-ui'

export const dynamic = 'force-dynamic'

export default async function CompanyFichePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const orgIds = await getOrgIdsOfUser()
  const fiche = await getCompanyFiche(companyId, orgIds)
  if (!fiche) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/intervenants" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        ← Intervenants
      </Link>

      {/* ── SITUATION ACTUELLE — carte de synthèse ──────────────────────────────── */}
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
            <Building2 className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{fiche.name}</h1>
              <AttentionBadge level={fiche.attention.level} />
              {fiche.isArchived && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Archivée</span>}
            </div>
            {/* 3 faits principaux. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                fiche.activeRoles.length ? fiche.activeRoles.join(', ') : null,
                `${fiche.activeSitesCount} chantier${fiche.activeSitesCount > 1 ? 's' : ''} actif${fiche.activeSitesCount > 1 ? 's' : ''}`,
                `${fiche.openCount} action${fiche.openCount > 1 ? 's' : ''} ouverte${fiche.openCount > 1 ? 's' : ''}`,
                fiche.noReferentCount > 0 ? `${fiche.noReferentCount} sans référent` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {fiche.attention.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fiche.attention.reasons.map((r) => (
                  <span key={r.code} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{r.label}</span>
                ))}
              </div>
            )}
            {(fiche.email || fiche.phone || fiche.website || fiche.siret) && (
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {fiche.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden /> {fiche.email}</span>}
                {fiche.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden /> {fiche.phone}</span>}
                {fiche.website && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden /> {fiche.website}</span>}
                {fiche.siret && <span>SIRET {fiche.siret}</span>}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── PRÉSENCE OPÉRATIONNELLE — chantiers actifs + rôles ───────────────────── */}
      <FicheSection title="Présence opérationnelle" count={fiche.activeCasting.length}>
        {fiche.activeCasting.length === 0 ? (
          <FicheEmpty>Aucun chantier actif.</FicheEmpty>
        ) : (
          fiche.activeCasting.map((c) => (
            <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Rôle · ${c.role}`} />
          ))
        )}
      </FicheSection>

      {/* ── CONTACTS ────────────────────────────────────────────────────────────── */}
      <FicheSection title="Contacts" count={fiche.contacts.length}>
        {fiche.contacts.length === 0 ? (
          <FicheEmpty>Aucun contact connu pour cette entreprise.</FicheEmpty>
        ) : (
          fiche.contacts.map((c) => (
            <FicheLinkRow
              key={c.id}
              href={c.href}
              icon={<User className="h-4 w-4" aria-hidden />}
              label={c.name}
              sub={[c.function, c.isMainCasting ? 'Contact principal' : null, c.isReferent ? 'Référent d’actions' : null].filter(Boolean).join(' · ') || null}
            />
          ))
        )}
      </FicheSection>

      {/* ── TRAVAIL EN COURS — actions ──────────────────────────────────────────── */}
      <FicheSection title="Travail en cours" count={fiche.openCount}>
        {fiche.actions.length === 0 ? (
          <FicheEmpty>Aucune action ouverte dont cette entreprise est responsable.</FicheEmpty>
        ) : (
          fiche.actions.map((a) => <ActionRow key={a.id} action={a} />)
        )}
      </FicheSection>

      {/* ── HISTORIQUE — chantiers clôturés ─────────────────────────────────────── */}
      {fiche.historicalCasting.length > 0 && (
        <FicheSection title="Historique">
          {fiche.historicalCasting.map((c) => (
            <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4 opacity-60" aria-hidden />} label={c.siteName} sub={`Casting clôturé · ${c.role}`} />
          ))}
        </FicheSection>
      )}
    </div>
  )
}

function ActionRow({ action }: { action: CompanyFiche['actions'][number] }) {
  return (
    <FicheLinkRow
      href={action.href}
      icon={<ArrowRight className="h-4 w-4" aria-hidden />}
      label={action.title}
      sub={[action.siteName, action.hasReferent ? null : 'sans contact référent'].filter(Boolean).join(' · ')}
      trailing={
        action.overdue ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-red-700 dark:text-red-400">
            <Clock className="h-3 w-3" aria-hidden /> En retard
          </span>
        ) : action.dueDate ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{action.dueDate}</span>
        ) : undefined
      }
    />
  )
}
