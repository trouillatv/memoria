// Fiche PERSONNE (Lot 2B.3A) — surface de LECTURE d'un contact (company_contacts).
// Ordre imposé (Vincent) : Situation actuelle → Organisation → Travail en cours →
// Historique → Navigation. La CARTE DE SYNTHÈSE en tête répond en < 5 s : « pourquoi
// cet acteur mérite-t-il mon attention ? ». Garde d'accès : kill-switch + privilégié
// (checkIntervenantsPageAccess). Aucune donnée nouvelle : liens vers les surfaces
// propriétaires, jamais de copie.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { User, Building2, Users, MapPin, ArrowRight, AlertTriangle, Clock, Mail, Phone, KeyRound } from 'lucide-react'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getPersonFiche, type PersonFiche } from '@/lib/db/person-fiche'
import { attentionLevelLabel } from '@/lib/knowledge/actor-attention'

export const dynamic = 'force-dynamic'

const STATUS_LABEL = { active: 'Actif', incomplete: 'Incomplet', historical: 'Historique' } as const

export default async function PersonFichePage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const orgIds = await getOrgIdsOfUser()
  const fiche = await getPersonFiche(contactId, orgIds)
  if (!fiche) notFound()

  const activeTeams = fiche.teams.filter((t) => t.active)
  const historicalTeams = fiche.teams.filter((t) => !t.active)
  const activeCasting = fiche.casting.filter((c) => c.active)
  const historicalCasting = fiche.casting.filter((c) => !c.active)
  const openCount = fiche.actionsAsReferent.length

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/intervenants" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        ← Intervenants
      </Link>

      {/* ── SITUATION ACTUELLE — carte de synthèse (le point le plus important) ── */}
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
            <User className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{fiche.name}</h1>
              <AttentionBadge fiche={fiche} />
              {fiche.status !== 'active' && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[fiche.status]}</span>
              )}
            </div>
            {/* 3 faits principaux — identité + faits saillants, sans ouvrir le détail. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                fiche.category,
                fiche.function,
                fiche.companyName,
                activeTeams[0] ? `Équipe ${activeTeams[0].name}` : null,
                activeCasting.length ? `${activeCasting.length} chantier${activeCasting.length > 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {/* Raisons de l'état — toujours explicites, jamais un niveau seul. */}
            {fiche.attention.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fiche.attention.reasons.map((r) => (
                  <span key={r.code} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">
                    <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden /> {r.label}
                  </span>
                ))}
              </div>
            )}
            {(fiche.email || fiche.phone || fiche.mobile) && (
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {fiche.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden /> {fiche.email}</span>}
                {(fiche.phone || fiche.mobile) && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden /> {[fiche.phone, fiche.mobile].filter(Boolean).join(' · ')}</span>}
              </div>
            )}
            {fiche.linkedAccountUserId && (
              <Link href={`/intervenants/${fiche.linkedAccountUserId}`} className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-brand-200">
                <KeyRound className="h-3 w-3" aria-hidden /> Compte lié possible — ouvrir la fiche compte
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ── ORGANISATION — rattachements ────────────────────────────────────────── */}
      <Section title="Organisation">
        {fiche.companyName && (
          <Row icon={<Building2 className="h-4 w-4" aria-hidden />} label={fiche.companyName} sub="Entreprise de rattachement" />
        )}
        {activeTeams.map((t) => (
          <LinkRow key={t.id} href={t.href} icon={<Users className="h-4 w-4" aria-hidden />} label={t.name} sub="Équipe" />
        ))}
        {activeCasting.map((c) => (
          <LinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Casting · ${c.role}`} />
        ))}
        {!fiche.companyName && activeTeams.length === 0 && activeCasting.length === 0 && (
          <Empty>Aucun rattachement actif.</Empty>
        )}
      </Section>

      {/* ── TRAVAIL EN COURS — actions ouvertes ─────────────────────────────────── */}
      <Section title="Travail en cours" count={openCount}>
        {fiche.actionsAsReferent.length === 0 ? (
          <Empty>Aucune action ouverte dont cette personne est référente.</Empty>
        ) : (
          fiche.actionsAsReferent.map((a) => <ActionRow key={a.id} action={a} />)
        )}
        {fiche.actionsViaCompany.length > 0 && (
          <div className="pt-1">
            <p className="mb-1 mt-2 text-xs font-medium text-muted-foreground">Son entreprise est responsable de</p>
            {fiche.actionsViaCompany.map((a) => <ActionRow key={a.id} action={a} />)}
          </div>
        )}
      </Section>

      {/* ── HISTORIQUE UTILE ────────────────────────────────────────────────────── */}
      {(fiche.decisions.length > 0 || historicalCasting.length > 0 || historicalTeams.length > 0) && (
        <Section title="Historique">
          {fiche.decisions.map((d) => (
            <LinkRow key={d.id} href={`/sites/${d.siteId}`} icon={<ArrowRight className="h-4 w-4" aria-hidden />} label={d.title} sub={`Décision · ${d.siteName}${d.date ? ` · ${d.date}` : ''}`} />
          ))}
          {historicalCasting.map((c) => (
            <LinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4 opacity-60" aria-hidden />} label={c.siteName} sub={`Casting clôturé · ${c.role}`} />
          ))}
          {historicalTeams.map((t) => (
            <LinkRow key={t.id} href={t.href} icon={<Users className="h-4 w-4 opacity-60" aria-hidden />} label={t.name} sub="Équipe (passée)" />
          ))}
        </Section>
      )}
    </div>
  )
}

function AttentionBadge({ fiche }: { fiche: PersonFiche }) {
  const level = fiche.attention.level
  if (level === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {attentionLevelLabel(level)}
      </span>
    )
  }
  const cls = level === 'urgent'
    ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300'
    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      <AlertTriangle className="h-3 w-3" aria-hidden /> {attentionLevelLabel(level)}
    </span>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground/90">
        {title}{typeof count === 'number' && count > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function rowInner(icon: React.ReactNode, label: string, sub: string | null, trailing?: React.ReactNode) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{label}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {trailing}
    </div>
  )
}

function Row({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string | null }) {
  return <div className="rounded-lg px-1.5 py-1.5">{rowInner(icon, label, sub)}</div>
}

function LinkRow({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string | null }) {
  return (
    <Link href={href} className="group block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
      {rowInner(icon, label, sub, <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-foreground" aria-hidden />)}
    </Link>
  )
}

function ActionRow({ action }: { action: PersonFiche['actionsAsReferent'][number] }) {
  return (
    <Link href={action.href} className="group block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
      {rowInner(
        <ArrowRight className="h-4 w-4" aria-hidden />,
        action.title,
        action.siteName,
        <span className="flex shrink-0 items-center gap-2">
          {action.overdue && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-700 dark:text-red-400">
              <Clock className="h-3 w-3" aria-hidden /> En retard
            </span>
          )}
          {!action.overdue && action.dueDate && <span className="text-xs text-muted-foreground tabular-nums">{action.dueDate}</span>}
        </span>,
      )}
    </Link>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-xs italic text-muted-foreground">{children}</p>
}
