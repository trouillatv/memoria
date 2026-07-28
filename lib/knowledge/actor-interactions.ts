// ── INTERACTIONS ÉLÉMENTAIRES ENTRE ACTEURS (V3, étape 2) ────────────────────
// PUR, sans 'server-only' : produit une collection normalisée de FAITS élémentaires
// datés — AUCUN score, AUCUNE pondération, AUCUNE récence (ça viendra aux étapes 3-4).
//
// Trois signaux STRUCTURELS FIABLES (cadrage 2026-07-28) :
//   · co_casting  : deux ENTREPRISES dans le casting du même chantier, périodes
//                   qui SE CHEVAUCHENT réellement ;
//   · co_team     : deux PERSONNES dans la même équipe, appartenances qui se
//                   chevauchent ;
//   · co_action   : une PERSONNE (référent) et une ENTREPRISE (responsable) sur la
//                   MÊME action (événement ponctuel).
//
// Règles (Vincent) : couple CANONICALISÉ (ordre déterministe), occurrences NON
// écrasées (deux actions distinctes = deux interactions), durée vs événement
// distingués, provenance obligatoire (sourceType/sourceId), AUCUNE inférence
// transitive (pas de personne↔personne parce que leurs entreprises partagent un
// chantier). L'isolation par organisation est assurée en amont (fetcher).

export type ActorInteractionKind = 'co_casting' | 'co_team' | 'co_action'
export type ActorRefKind = 'person' | 'company'

export interface ActorRef {
  kind: ActorRefKind
  id: string
}

export interface ActorInteraction {
  /** Couple CANONIQUE : refKey(actorA) <= refKey(actorB) (jamais A↔B ET B↔A). */
  actorA: ActorRef
  actorB: ActorRef
  kind: ActorInteractionKind
  /** Début de l'interaction (activeFrom pour un intervalle, date pour un événement). */
  occurredAt: string
  /** Intervalle actif (co_casting / co_team) — absent pour un événement (co_action). */
  activeFrom?: string
  /** Fin de l'intervalle ; null = en cours. */
  activeTo?: string | null
  siteId?: string
  teamId?: string
  actionId?: string
  /** Provenance : « pourquoi dis-tu qu'ils ont collaboré ? » */
  sourceType: 'site_intervenant' | 'team_field_member' | 'site_action'
  sourceId: string
}

export interface ActorInteractionInputs {
  /** Une ligne de casting = une entreprise sur un chantier, avec sa période. */
  castings: Array<{ siteId: string; companyId: string; from: string | null; to: string | null }>
  /** Une appartenance terrain = une personne dans une équipe, avec sa période. */
  teamMemberships: Array<{ teamId: string; contactId: string; from: string | null; to: string | null }>
  /** Une action avec son référent (personne) et/ou son responsable (entreprise). */
  actions: Array<{ id: string; contactId: string | null; companyId: string | null; occurredAt: string | null }>
}

const refKey = (r: ActorRef): string => `${r.kind}:${r.id}`

/** Couple canonique déterministe (évite de compter A↔B et B↔A séparément). */
function canonicalPair(a: ActorRef, b: ActorRef): [ActorRef, ActorRef] {
  return refKey(a) <= refKey(b) ? [a, b] : [b, a]
}

/** Intervalle de chevauchement de deux périodes (`to = null` = en cours). null si
 *  pas de chevauchement, ou si une période est incohérente/indatable. */
function overlap(from1: string | null, to1: string | null, from2: string | null, to2: string | null): { from: string; to: string | null } | null {
  if (!from1 || !from2) return null                    // une interaction doit être datée
  if (to1 && from1 > to1) return null                  // période 1 incohérente
  if (to2 && from2 > to2) return null                  // période 2 incohérente
  const from = from1 > from2 ? from1 : from2           // max des débuts
  let to: string | null
  if (to1 == null && to2 == null) to = null            // deux en cours → chevauchement ouvert
  else if (to1 == null) to = to2
  else if (to2 == null) to = to1
  else to = to1 < to2 ? to1 : to2                      // min des fins
  if (to != null && from > to) return null             // débuts postérieurs à la 1ère fin
  return { from, to }
}

/** Présence d'un acteur dans un contexte (chantier/équipe) = intervalle englobant
 *  ses lignes valides ; `to = null` dès qu'une ligne est encore ouverte. null si
 *  aucune ligne datable. */
function mergeSpan(rows: Array<{ from: string | null; to: string | null }>): { from: string; to: string | null } | null {
  let minFrom: string | null = null
  let maxTo: string | null = null
  let open = false
  for (const r of rows) {
    if (!r.from) continue
    if (r.to && r.from > r.to) continue                // ligne incohérente → ignorée
    if (minFrom == null || r.from < minFrom) minFrom = r.from
    if (r.to == null) open = true
    else if (maxTo == null || r.to > maxTo) maxTo = r.to
  }
  if (minFrom == null) return null
  return { from: minFrom, to: open ? null : maxTo }
}

/** Groupe des lignes par contexte puis par acteur → spans par acteur. */
function spansByActor<T extends { from: string | null; to: string | null }>(
  rows: T[], contextOf: (r: T) => string, actorOf: (r: T) => string,
): Map<string, Map<string, { from: string; to: string | null }>> {
  const byContext = new Map<string, Map<string, T[]>>()
  for (const r of rows) {
    const c = contextOf(r), a = actorOf(r)
    if (!byContext.has(c)) byContext.set(c, new Map())
    const m = byContext.get(c)!
    if (!m.has(a)) m.set(a, [])
    m.get(a)!.push(r)
  }
  const out = new Map<string, Map<string, { from: string; to: string | null }>>()
  for (const [c, m] of byContext) {
    const spans = new Map<string, { from: string; to: string | null }>()
    for (const [a, rs] of m) { const s = mergeSpan(rs); if (s) spans.set(a, s) }
    out.set(c, spans)
  }
  return out
}

/** Faits élémentaires datés depuis les 3 signaux fiables. Déterministe. */
export function buildActorInteractions(input: ActorInteractionInputs): ActorInteraction[] {
  const out: ActorInteraction[] = []
  const seen = new Set<string>()
  const emit = (i: ActorInteraction, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    out.push(i)
  }

  // ── co_casting : entreprises co-présentes sur un chantier, périodes chevauchantes ──
  const castingSpans = spansByActor(input.castings, (r) => r.siteId, (r) => r.companyId)
  for (const [siteId, spans] of castingSpans) {
    const companies = [...spans.keys()].sort()
    for (let i = 0; i < companies.length; i++) for (let j = i + 1; j < companies.length; j++) {
      const sx = spans.get(companies[i]!)!, sy = spans.get(companies[j]!)!
      const ov = overlap(sx.from, sx.to, sy.from, sy.to)
      if (!ov) continue
      const [a, b] = canonicalPair({ kind: 'company', id: companies[i]! }, { kind: 'company', id: companies[j]! })
      emit(
        { actorA: a, actorB: b, kind: 'co_casting', occurredAt: ov.from, activeFrom: ov.from, activeTo: ov.to, siteId, sourceType: 'site_intervenant', sourceId: siteId },
        `co_casting|${refKey(a)}|${refKey(b)}|${siteId}`,
      )
    }
  }

  // ── co_team : personnes co-présentes dans une équipe, appartenances chevauchantes ──
  const teamSpans = spansByActor(input.teamMemberships, (r) => r.teamId, (r) => r.contactId)
  for (const [teamId, spans] of teamSpans) {
    const persons = [...spans.keys()].sort()
    for (let i = 0; i < persons.length; i++) for (let j = i + 1; j < persons.length; j++) {
      const sx = spans.get(persons[i]!)!, sy = spans.get(persons[j]!)!
      const ov = overlap(sx.from, sx.to, sy.from, sy.to)
      if (!ov) continue
      const [a, b] = canonicalPair({ kind: 'person', id: persons[i]! }, { kind: 'person', id: persons[j]! })
      emit(
        { actorA: a, actorB: b, kind: 'co_team', occurredAt: ov.from, activeFrom: ov.from, activeTo: ov.to, teamId, sourceType: 'team_field_member', sourceId: teamId },
        `co_team|${refKey(a)}|${refKey(b)}|${teamId}`,
      )
    }
  }

  // ── co_action : référent (personne) ↔ responsable (entreprise) sur la même action ──
  for (const act of input.actions) {
    if (!act.contactId || !act.companyId || !act.occurredAt) continue // il faut LES DEUX + une date
    const [a, b] = canonicalPair({ kind: 'person', id: act.contactId }, { kind: 'company', id: act.companyId })
    emit(
      { actorA: a, actorB: b, kind: 'co_action', occurredAt: act.occurredAt, actionId: act.id, sourceType: 'site_action', sourceId: act.id },
      `co_action|${refKey(a)}|${refKey(b)}|${act.id}`,
    )
  }

  return out
}
