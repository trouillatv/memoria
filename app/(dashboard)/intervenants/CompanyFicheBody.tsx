// Corps de la fiche ENTREPRISE — PARTAGÉ entre la page dédiée et le panneau maître-
// détail de /intervenants. Une seule source de rendu. Purement présentationnel.

import { Building2, Layers, MapPin, User, ArrowRight, Clock, Mail, Phone, Globe, FileText } from 'lucide-react'
import type { CompanyFiche } from '@/lib/db/company-fiche'
import type { ActorsGraph } from '@/lib/knowledge/actors-graph'
import { AttentionBadge, FicheSection, FicheLinkRow, FicheRow, FicheEmpty } from './fiche-ui'
import { ActorNetworkExplorer } from './graph/ActorNetworkExplorer'
import type { SelectableKind } from './graph/ActorsGraphCanvas'

// Date de mention (site_intervenants.effective_from — un DATE brut, jamais un
// horodatage) : reformatage direct, sans passer par Date()/fuseau — inutile et
// risqué sur une valeur qui n'a pas d'heure.
function frDateShort(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : null
}

export function CompanyFicheBody({ fiche, network, onSelectActor }: {
  fiche: CompanyFiche
  network?: ActorsGraph | null
  onSelectActor?: (kind: SelectableKind, id: string) => void
}) {
  const networkSummary = [
    fiche.activeSitesCount ? `intervient sur ${fiche.activeSitesCount} chantier${fiche.activeSitesCount > 1 ? 's' : ''}` : null,
    fiche.contacts.length ? `${fiche.contacts.length} contact${fiche.contacts.length > 1 ? 's' : ''}` : null,
    fiche.openCount ? `responsable de ${fiche.openCount} action${fiche.openCount > 1 ? 's' : ''} ouverte${fiche.openCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="space-y-5">
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
            {/* FAITS OPÉRATIONNELS d'abord (prominents). */}
            <p className="mt-1.5 text-sm font-medium text-foreground/90">
              {fiche.openCount > 0 ? (
                <>
                  {fiche.openCount} action{fiche.openCount > 1 ? 's' : ''} ouverte{fiche.openCount > 1 ? 's' : ''}
                  {fiche.overdueCount > 0 && <span className="text-red-700 dark:text-red-400"> · {fiche.overdueCount} en retard</span>}
                  {fiche.noReferentCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {fiche.noReferentCount} sans référent</span>}
                  <span className="text-muted-foreground font-normal"> · {fiche.activeSitesCount} chantier{fiche.activeSitesCount > 1 ? 's' : ''} actif{fiche.activeSitesCount > 1 ? 's' : ''}</span>
                </>
              ) : fiche.activeSitesCount > 0 ? (
                <>{fiche.activeSitesCount} chantier{fiche.activeSitesCount > 1 ? 's' : ''} actif{fiche.activeSitesCount > 1 ? 's' : ''}<span className="text-muted-foreground font-normal"> · aucune action ouverte</span></>
              ) : (
                <span className="text-muted-foreground font-normal">Aucun chantier actif ni action ouverte</span>
              )}
            </p>
            {/* Phrase de synthèse (discrète) — jamais de rôle ici : un rôle mentionné
                n'est pas un fait à résumer en une ligne, voir la section dédiée. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                fiche.activeCasting[0] ? `Intervient sur ${fiche.activeCasting[0].siteName}` : null,
                `${fiche.contacts.length} contact${fiche.contacts.length > 1 ? 's' : ''} connu${fiche.contacts.length > 1 ? 's' : ''}`,
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

      {/* ── RÉSEAU — l'explorateur DANS la fiche (aucune fenêtre intermédiaire). */}
      {network && network.nodes.length > 1 && (
        <FicheSection title="Réseau de collaboration">
          {networkSummary && <p className="mb-2.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">{fiche.name}</span> {networkSummary}.</p>}
          <ActorNetworkExplorer key={fiche.id} network={network} focusId={`co_${fiche.id}`} onSelectActor={onSelectActor} />
        </FicheSection>
      )}

      {/* ── RÔLES MENTIONNÉS — jamais « le » rôle actuel, des mentions datées ────── */}
      {/* Plusieurs mentions actives simultanées (même une classification qui dérive
          d'un PV à l'autre) restent listées séparément : ne jamais arbitrer entre
          elles ni en déduire un changement de rôle. */}
      <FicheSection title="Rôles mentionnés dans les documents" count={fiche.roleMentions.length}>
        {fiche.roleMentions.length === 0 ? (
          <FicheEmpty>Aucun rôle mentionné.</FicheEmpty>
        ) : (
          fiche.roleMentions.map((r) => {
            const date = frDateShort(r.effectiveFrom)
            return (
              <FicheRow
                key={`${r.role}-${r.effectiveFrom ?? ''}`}
                icon={<FileText className="h-4 w-4" aria-hidden />}
                label={r.role}
                sub={date ? `Mention du ${date}` : 'Date de mention inconnue'}
              />
            )
          })
        )}
      </FicheSection>

      {/* ── PRÉSENCE OPÉRATIONNELLE — chantiers actifs ───────────────────────────── */}
      <FicheSection title="Présence opérationnelle" count={fiche.activeCasting.length}>
        {fiche.activeCasting.length === 0 ? (
          <FicheEmpty>Aucun chantier actif.</FicheEmpty>
        ) : (
          fiche.activeCasting.map((c) => {
            const date = frDateShort(c.effectiveFrom)
            return (
              <FicheLinkRow key={`${c.siteId}-${c.role}`} href={c.href} icon={<MapPin className="h-4 w-4" aria-hidden />} label={c.siteName} sub={`Rôle mentionné · ${c.role}${date ? ` — mention du ${date}` : ''}`} />
            )
          })
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

      {/* ── SUJETS PORTÉS — graphe bidirectionnel acteur → sujets canoniques ─────── */}
      {fiche.subjectsCarried.length > 0 && (
        <FicheSection title="Sujets portés" count={fiche.subjectsCarried.length}>
          {fiche.subjectsCarried.map((s) => (
            <FicheLinkRow
              key={s.subjectId}
              href={s.href}
              icon={<Layers className="h-4 w-4" aria-hidden />}
              label={s.subjectName}
              sub={[
                s.siteName,
                s.openCount > 0
                  ? `${s.openCount} action${s.openCount > 1 ? 's' : ''} ouverte${s.openCount > 1 ? 's' : ''}`
                  : 'aucune action ouverte',
                s.totalCount > s.openCount ? `${s.totalCount} au total` : null,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </FicheSection>
      )}

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
      sub={[action.siteName, action.assignedContactName ?? (action.hasReferent ? null : 'sans contact référent')].filter(Boolean).join(' · ')}
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
