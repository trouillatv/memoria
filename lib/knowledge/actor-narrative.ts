// ── NARRATION D'UN ACTEUR (V3 Phase 2) ───────────────────────────────────────
// DÉTERMINISTE : assemble en PHRASES des faits DÉJÀ calculés (relations agrégées
// étape 5 + contexte opérationnel). Aucune génération libre, aucune IA — on
// verbalise, on n'invente pas. Répond à « Pourquoi cette relation est-elle
// importante ? » / « Pourquoi est-ce que je vois cet acteur ? ». 6-8 phrases max.
// Les visites/CR communs N'y figurent PAS (co-présence non fiable → étape 6).

import { trendUiLabel, type ActorRelationsResult } from './actor-relation-view'
import type { ActorContext } from '@/lib/db/actor-context'

const monthYear = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))

/** Première date structurelle observée, tous liens confondus. */
function firstSeen(relations: ActorRelationsResult): string | null {
  let min: string | null = null
  for (const r of relations.relations) for (const e of r.explanation) {
    const d = e.activeFrom ?? e.observedAt
    if (d && (min == null || d < min)) min = d
  }
  return min
}

/** Récit factuel d'un acteur (personne/entreprise) — 6-8 phrases, ordonnées :
 *  identité/ancienneté → intensité → interlocuteur → chantiers → dernière
 *  interaction → évolution → risques. */
export function buildActorNarrative(kind: 'person' | 'company', label: string, relations: ActorRelationsResult, context: ActorContext | null): string[] {
  const rels = relations.relations
  const out: string[] = []

  // 1. Identité + ancienneté.
  const since = firstSeen(relations)
  if (since) out.push(`${kind === 'company' ? 'Vous travaillez avec' : 'Vous connaissez'} ${label} depuis ${monthYear(since)}.`)
  else out.push(`${label} apparaît dans votre réseau.`)

  // 2. Intensité (relation la plus forte + taille du réseau).
  const top = rels[0]
  if (top) {
    const tl = trendUiLabel(top.activity.trend)
    out.push(`Collaboration la plus forte : ${top.actor.label}${tl ? ` — ${tl.toLowerCase()}` : ''}.`)
    if (rels.length > 1) out.push(`En lien avec ${rels.length} acteurs au total.`)
  }

  // 3. Interlocuteur principal (pour une entreprise : la personne la plus liée).
  if (kind === 'company') {
    const topPerson = rels.find((r) => r.actor.kind === 'person')
    if (topPerson) out.push(`Interlocuteur principal : ${topPerson.actor.label}.`)
  }

  // 4. Chantiers (depuis le contexte : chantiers distincts cités).
  if (context) {
    const sites = [...new Set(context.timeline.map((e) => e.sub).filter((s): s is string => !!s))]
    if (sites.length) out.push(sites.length <= 3 ? `Chantiers concernés : ${sites.join(', ')}.` : `Actif sur ${sites.length} chantiers.`)
  }

  // 5. Dernière interaction observée.
  if (context && context.latest.length) {
    const last = [...context.latest].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!
    out.push(`Dernière interaction : ${last.label}${last.sub ? ` (${last.sub})` : ''}, ${monthYear(last.date)}.`)
  }

  // 6. Risques (Phase 7 amorcée — déterministes, jamais alarmistes sans fait).
  if (rels.length === 1) out.push('⚠ Réseau limité à un seul partenaire.')
  if (top?.activity.trend === 'decreasing') out.push('⚠ La collaboration principale est en baisse.')
  else if (top?.activity.trend === 'inactive') out.push('⚠ La collaboration principale est inactive.')

  return out.slice(0, 8)
}
