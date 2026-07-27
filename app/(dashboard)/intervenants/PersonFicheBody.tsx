// Corps de la fiche PERSONNE — PARTAGÉ entre la page dédiée (/intervenants/personne/[id])
// et le panneau maître-détail de /intervenants. Une seule source de rendu → aucune
// divergence entre les deux surfaces. Purement présentationnel (aucun hook, aucun
// server-only) → utilisable en Server Component comme en Client Component.

import Link from 'next/link'
import { User, Building2, Users, MapPin, ArrowRight, Clock, Mail, Phone, KeyRound } from 'lucide-react'
import type { PersonFiche } from '@/lib/db/person-fiche'
import type { ActorsGraph } from '@/lib/knowledge/actors-graph'
import { AttentionBadge, FicheSection, FicheRow, FicheLinkRow, FicheEmpty } from './fiche-ui'
import { ActorNetworkExplorer } from './graph/ActorNetworkExplorer'
import type { SelectableKind } from './graph/ActorsGraphCanvas'

const STATUS_LABEL = { active: 'Actif', incomplete: 'Incomplet', historical: 'Historique' } as const

export function PersonFicheBody({ fiche, network, onSelectActor }: {
  fiche: PersonFiche
  network?: ActorsGraph | null
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  const activeTeams = fiche.teams.filter((t) => t.active)
  const historicalTeams = fiche.teams.filter((t) => !t.active)
  const activeCasting = fiche.casting.filter((c) => c.active)
  const historicalCasting = fiche.casting.filter((c) => !c.active)

  const nRef = fiche.actionsAsReferent.length
  const networkSummary = [
    fiche.companyName ? `travaille chez ${fiche.companyName}` : null,
    activeTeams[0] ? `dans l’équipe ${activeTeams[0].name}` : null,
    activeCasting.length ? `intervient sur ${activeCasting.length} chantier${activeCasting.length > 1 ? 's' : ''}` : null,
    nRef ? `référent${fiche.category === 'Agent interne' ? '' : 'e'} de ${nRef} action${nRef > 1 ? 's' : ''} ouverte${nRef > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5">
      {/* ── SITUATION ACTUELLE — carte de synthèse (le point le plus important) ── */}
      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
            <User className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{fiche.name}</h1>
              <AttentionBadge level={fiche.attention.level} />
              {fiche.status !== 'active' && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABEL[fiche.status]}</span>
              )}
            </div>
            {/* FAITS OPÉRATIONNELS d'abord (prominents) — la règle des 5 secondes. */}
            <p className="mt-1.5 text-sm font-medium text-foreground/90">
              {fiche.actionsAsReferent.length > 0 ? (
                <>
                  {fiche.actionsAsReferent.length} action{fiche.actionsAsReferent.length > 1 ? 's' : ''} ouverte{fiche.actionsAsReferent.length > 1 ? 's' : ''}
                  {fiche.overdueCount > 0 && <span className="text-red-700 dark:text-red-400"> · {fiche.overdueCount} en retard</span>}
                  {activeCasting.length > 0 && <span className="text-muted-foreground font-normal"> · {activeCasting.length} chantier{activeCasting.length > 1 ? 's' : ''}</span>}
                </>
              ) : activeCasting.length > 0 ? (
                <>{activeCasting.length} chantier{activeCasting.length > 1 ? 's' : ''} en cours<span className="text-muted-foreground font-normal"> · aucune action ouverte</span></>
              ) : (
                <span className="text-muted-foreground font-normal">Aucune action ni chantier en cours</span>
              )}
            </p>
            {/* Phrase de synthèse (biographie, discrète) — ce qu'elle EST, après ce qu'elle FAIT. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                fiche.companyName ? `${fiche.category} de ${fiche.companyName}` : fiche.category,
                fiche.function,
                activeTeams[0] ? `Équipe ${activeTeams[0].name}` : null,
                activeCasting[0] ? `Intervient sur ${activeCasting[0].siteName}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {/* Raisons de l'état — toujours explicites, jamais un niveau seul. */}
            {fiche.attention.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fiche.attention.reasons.map((r) => (
                  <span key={r.code} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80">{r.label}</span>
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

      {/* ── RÉSEAU — l'explorateur DANS la fiche (tout au même endroit, aucune
          fenêtre intermédiaire) : sélection nœud/lien en place, narration, Suivre. */}
      {network && network.nodes.length > 1 && (
        <FicheSection title="Réseau de collaboration">
          {networkSummary && <p className="mb-2.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">{fiche.name}</span> {networkSummary}.</p>}
          <ActorNetworkExplorer network={network} focusId={`p_${fiche.id}`} onSelectActor={onSelectActor} />
        </FicheSection>
      )}

      {/* ── ORGANISATION — rattachements ────────────────────────────────────────── */}
      <FicheSection title="Organisation">
        {fiche.companyName && (
          <FicheRow icon={<Building2 className="h-4 w-4" aria-hidden />} label={fiche.companyName} sub="Entreprise de rattachement" />
        )}
        {activeTeams.map((t) => (
          <FicheLinkRow key={t.id} href={t.href} icon={<Users className="h-4 w-4" aria-hidden />} label={t.name} sub="Équipe" />
        ))}
        {activeCasting.map((c) => (
          <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Casting · ${c.role}`} />
        ))}
        {!fiche.companyName && activeTeams.length === 0 && activeCasting.length === 0 && (
          <FicheEmpty>Aucun rattachement actif.</FicheEmpty>
        )}
      </FicheSection>

      {/* ── TRAVAIL EN COURS — actions ouvertes ─────────────────────────────────── */}
      <FicheSection title="Travail en cours" count={fiche.actionsAsReferent.length}>
        {fiche.actionsAsReferent.length === 0 ? (
          <FicheEmpty>Aucune action ouverte dont cette personne est référente.</FicheEmpty>
        ) : (
          fiche.actionsAsReferent.map((a) => <ActionRow key={a.id} action={a} />)
        )}
        {fiche.actionsViaCompany.length > 0 && (
          <div className="pt-1">
            <p className="mb-1 mt-2 text-xs font-medium text-muted-foreground">Son entreprise est responsable de</p>
            {fiche.actionsViaCompany.map((a) => <ActionRow key={a.id} action={a} />)}
          </div>
        )}
      </FicheSection>

      {/* ── HISTORIQUE UTILE ────────────────────────────────────────────────────── */}
      {(fiche.decisions.length > 0 || historicalCasting.length > 0 || historicalTeams.length > 0) && (
        <FicheSection title="Historique">
          {fiche.decisions.map((d) => (
            <FicheLinkRow key={d.id} href={`/sites/${d.siteId}`} icon={<ArrowRight className="h-4 w-4" aria-hidden />} label={d.title} sub={`Décision · ${d.siteName}${d.date ? ` · ${d.date}` : ''}`} />
          ))}
          {historicalCasting.map((c) => (
            <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4 opacity-60" aria-hidden />} label={c.siteName} sub={`Casting clôturé · ${c.role}`} />
          ))}
          {historicalTeams.map((t) => (
            <FicheLinkRow key={t.id} href={t.href} icon={<Users className="h-4 w-4 opacity-60" aria-hidden />} label={t.name} sub="Équipe (passée)" />
          ))}
        </FicheSection>
      )}

    </div>
  )
}

function ActionRow({ action }: { action: PersonFiche['actionsAsReferent'][number] }) {
  return (
    <FicheLinkRow
      href={action.href}
      icon={<ArrowRight className="h-4 w-4" aria-hidden />}
      label={action.title}
      sub={action.siteName}
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
