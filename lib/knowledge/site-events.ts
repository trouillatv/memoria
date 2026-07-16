import 'server-only'

// ── READ MODEL : CE QUE LA DERNIÈRE VISITE A CHANGÉ ──────────────────────────
// L'accueil ne pose qu'une question : « qu'est-ce qui a bougé, et qu'est-ce que je
// dois faire ? ». Ce read model y répond — il ne raconte rien d'autre.
//
// Il lit le FLUX D'ÉVÉNEMENTS du chantier (readEvents) : une visite en produit —
// visite réalisée, synthèse générée, action proposée, échéance détectée. L'accueil
// est un point de vue sur ce flux ; l'Historique et le Planning en sont d'autres.
//
// LA RÈGLE, non négociable : les NOMBRES viennent de `getSiteOverview`, le même
// read model que la fiche chantier. Jamais d'un compte SQL parallèle. Deux chemins
// = deux vérités : la fiche dirait « 3 actions proposées » et l'accueil « 2 », et
// plus personne ne croirait ni l'un ni l'autre. Le repository ne sert ici qu'à
// DÉCOUVRIR quels chantiers ont bougé et à quelle heure.
//
// « Aujourd'hui » = la journée civile à Nouméa. Pas celle du serveur.

import { getSiteOverview, type KnowledgeItem, type SynthesisStatus } from '@/lib/knowledge/site-overview'
import { readEvents, type SiteEventRow } from '@/lib/knowledge/repository'
import { getOrgId } from '@/lib/db/users'
import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import { echeanceDateLabel, A_PLANIFIER_LABEL } from '@/lib/visits/echeance-labels'
import { todayLocalIso } from '@/lib/time/local-date'
import { visitDateLabel } from '@/lib/chantier/overview-labels'

/** Un fait daté, dit avec les mots du conducteur. « 11:57 · Visite terminée ». */
export interface ChangeEvent {
  id: string
  at: string
  label: string
}

/** Une échéance qui attend — la prochaine datée, ou celles à planifier. */
export interface DeadlineAhead {
  id: string
  title: string
  /** « 28 juillet » si datée, sinon la contrainte dite (« Avant le démarrage »). */
  when: string
  /** Vrai tant qu'aucune date n'a été décidée : elle attend une planification. */
  toPlan: boolean
}

/** Ce qu'un chantier a produit depuis sa dernière visite. Compteurs = ceux de sa fiche. */
export interface SiteImpact {
  siteId: string
  siteName: string
  synthesisStatus: SynthesisStatus
  /** Ce que le chantier attend — l'accueil doit être ACTIONNABLE, pas un journal.
   *  La prochaine datée d'abord ; sinon ce qui reste à planifier. */
  deadlines: DeadlineAhead[]
  /** Ce que la visite a fait APPARAÎTRE aujourd'hui (des ajouts, pas des stocks). */
  added: { actions: number; watchpoints: number; deadlines: number; stakeholders: number; knowledge: number }
  /** Les premiers titres — « à traiter » se lit, ne se compte pas. */
  todo: KnowledgeItem[]
  events: ChangeEvent[]
  /** Le fait le plus récent : donne la sensation de mouvement (« il y a 15 min »). */
  lastEventAt: string
  /** « Depuis votre visite d'hier » — le récit part de CE que le conducteur a fait,
   *  pas d'une journée de calendrier. « Aujourd'hui » quand aucune visite ne borne. */
  sinceLabel: string
}

export interface VisitImpact {
  sites: SiteImpact[]
  /** Tous les faits, chantiers confondus, dans l'ordre du récit. */
  events: Array<ChangeEvent & { siteId: string; siteName: string }>
}

/** Jusqu'où on regarde en arrière pour retrouver la dernière visite. */
const LOOKBACK_DAYS = 14
/** Le récit d'un chantier : assez large pour raconter, borné pour rester lisible. */
const HISTORY_DAYS = 180
const TODO_LIMIT = 3
/** Ce que le chantier attend — borné : l'accueil montre, il n'inventorie pas. */
const DEADLINES_LIMIT = 3
const EVENTS_LIMIT = 8

export function emptyVisitImpact(): VisitImpact {
  return { sites: [], events: [] }
}

/** Le mot du conducteur quand IL a tranché. « 1 action confirmée » : la preuve que
 *  la boucle proposition → travail réel s'est fermée, et à quelle heure. */
function confirmedLabel(kind: string, count: number): string | null {
  const s = count > 1
  switch (kind) {
    case 'action': return `${count} action${s ? 's' : ''} confirmée${s ? 's' : ''}`
    case 'deadline': return `${count} échéance${s ? 's' : ''} confirmée${s ? 's' : ''}`
    case 'watchpoint': return `${count} point${s ? 's' : ''} de vigilance confirmé${s ? 's' : ''}`
    case 'stakeholder': return `${count} intervenant${s ? 's' : ''} confirmé${s ? 's' : ''}`
    case 'knowledge': return `${count} information${s ? 's' : ''} confirmée${s ? 's' : ''}`
    case 'decision': return `${count} décision${s ? 's' : ''} confirmée${s ? 's' : ''}`
    default: return null
  }
}

/** Le mot du conducteur pour un type de proposition. Jamais « proposal », jamais un kind. */
function proposalLabel(kind: string, count: number): string | null {
  const s = count > 1
  switch (kind) {
    case 'action': return `${count} action${s ? 's' : ''} proposée${s ? 's' : ''}`
    case 'deadline': return `${count} échéance${s ? 's' : ''} détectée${s ? 's' : ''}`
    case 'watchpoint': return `${count} point${s ? 's' : ''} de vigilance`
    case 'stakeholder': return `${count} intervenant${s ? 's' : ''} identifié${s ? 's' : ''}`
    case 'knowledge': return `${count} information${s ? 's' : ''} à savoir`
    case 'decision': return `${count} décision${s ? 's' : ''} relevée${s ? 's' : ''}`
    default: return null
  }
}

/** Les faits d'UN chantier, dits en clair. Les propositions nées à la même seconde
 *  sont UN fait (« 3 actions proposées »), pas trois lignes qui se répètent. */
function buildEvents(rows: SiteEventRow[]): ChangeEvent[] {
  const out: ChangeEvent[] = []
  for (const r of rows) {
    if (r.kind === 'visit_ended') out.push({ id: `visit-${r.at}`, at: r.at, label: 'Visite terminée' })
    if (r.kind === 'synthesis_created') out.push({ id: `synth-${r.at}`, at: r.at, label: 'Synthèse créée' })
  }
  // Les propositions d'un même type arrivent en rafale (une analyse) : on les
  // regroupe sur l'instant de la dernière — « 3 actions proposées », un fait.
  const byKind = new Map<string, SiteEventRow[]>()
  for (const r of rows) {
    if (r.kind !== 'proposal_created' || !r.proposal_kind) continue
    const list = byKind.get(r.proposal_kind) ?? []
    list.push(r)
    byKind.set(r.proposal_kind, list)
  }
  for (const [kind, list] of byKind) {
    const label = proposalLabel(kind, list.length)
    if (!label) continue
    const at = list.reduce((max, r) => (r.at > max ? r.at : max), list[0].at)
    out.push({ id: `prop-${kind}-${at}`, at, label })
  }

  // Les confirmations : même regroupement, mais elles racontent l'inverse — non plus
  // ce que MemorIA a compris, mais ce que le conducteur a décidé d'en faire.
  const confirmedByKind = new Map<string, SiteEventRow[]>()
  for (const r of rows) {
    if (r.kind !== 'proposal_confirmed' || !r.proposal_kind) continue
    const list = confirmedByKind.get(r.proposal_kind) ?? []
    list.push(r)
    confirmedByKind.set(r.proposal_kind, list)
  }
  for (const [kind, list] of confirmedByKind) {
    const label = confirmedLabel(kind, list.length)
    if (!label) continue
    const at = list.reduce((max, r) => (r.at > max ? r.at : max), list[0].at)
    out.push({ id: `conf-${kind}-${at}`, at, label })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

function countKind(rows: SiteEventRow[], kind: string): number {
  return rows.filter((r) => r.kind === 'proposal_created' && r.proposal_kind === kind).length
}

/**
 * LE RÉCIT D'UN CHANTIER — les mêmes événements, tournés vers le passé.
 *
 * L'Historique répond « que s'est-il passé ? », l'accueil « qu'est-ce qui a
 * changé ? », le Planning « qu'est-ce qui arrive ? ». Trois questions, UN flux :
 * c'est ce qui garantit qu'ils ne se contrediront jamais, et qu'un futur type
 * d'événement (réunion, incident, validation) apparaîtra partout sans retoucher
 * un seul écran.
 *
 * La frise lisait des tables d'avant la connaissance : elle affichait « visite
 * terrain » et s'arrêtait là, alors que la visite avait produit dix objets. Elle
 * n'était pas vide — elle était branchée ailleurs.
 */
export async function getSiteHistory(siteId: string, days = HISTORY_DAYS): Promise<ChangeEvent[]> {
  const orgId = await getOrgId()
  const now = new Date()
  const from = new Date(now.getTime() - days * 86_400_000).toISOString()
  const rows = await readEvents(from, now.toISOString(), orgId, siteId).catch(() => [] as SiteEventRow[])
  if (rows.length === 0) return []
  // Le plus RÉCENT d'abord : une frise se lit en remontant le temps.
  return buildEvents(rows).reverse()
}

/**
 * Ce que la DERNIÈRE VISITE a changé, chantier par chantier.
 *
 * L'accueil ne demandait « qu'est-ce qui a bougé aujourd'hui ? » — et devenait donc
 * muet le lendemain : une visite du 15 juillet ne produisait plus rien le 17, alors
 * que c'est ELLE que le conducteur a en tête en ouvrant MemorIA. On regarde
 * maintenant en arrière jusqu'à la dernière visite de chaque chantier.
 *
 * Silence total quand rien n'a bougé : un accueil qui invente du mouvement ment.
 */
export async function getVisitImpact(): Promise<VisitImpact> {
  const orgId = await getOrgId()
  const now = new Date()
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const rows = await readEvents(from, now.toISOString(), orgId).catch(() => [] as SiteEventRow[])
  if (rows.length === 0) return emptyVisitImpact()

  const bySite = new Map<string, SiteEventRow[]>()
  for (const r of rows) {
    const list = bySite.get(r.site_id) ?? []
    list.push(r)
    bySite.set(r.site_id, list)
  }

  // UN getSiteOverview par chantier RÉELLEMENT touché — donc les mêmes nombres
  // que sa fiche, par construction. Borné à ce qui a bougé, pas au portefeuille.
  const sites = await Promise.all(
    [...bySite.entries()].map(async ([siteId, allRows]) => {
      const overview = await getSiteOverview(siteId).catch(() => null)
      if (!overview) return null

      // La dernière visite est le POINT DE DÉPART du récit : ce que le conducteur a
      // en tête, ce n'est pas « la journée », c'est « ma visite ». On ne garde que
      // ce qui s'est produit à partir d'elle. Sans visite dans la fenêtre, on
      // retombe sur la journée — un chantier peut bouger sans qu'on y aille.
      const lastVisitAt = allRows
        .filter((r) => r.kind === 'visit_ended')
        .reduce<string | null>((max, r) => (!max || r.at > max ? r.at : max), null)
      const startIso = lastVisitAt ?? `${todayLocalIso()}T00:00:00.000+11:00`
      const startMs = Date.parse(startIso)
      const siteRows = allRows.filter((r) => Date.parse(r.at) >= startMs)
      if (siteRows.length === 0) return null

      const events = buildEvents(siteRows)
      const lastEventAt = events.length > 0 ? events[events.length - 1].at : siteRows[0].at
      // Ce que le chantier ATTEND — pas ce qu'on a cliqué. Les datées d'abord (les
      // plus proches en premier), puis celles qui attendent une décision. Le
      // conducteur doit pouvoir agir depuis l'accueil, pas seulement constater.
      const deadlines: DeadlineAhead[] = (await listSiteDeadlines(siteId).catch(() => []))
        .map((d) => ({
          id: d.id,
          title: d.title,
          when: d.due_date ? echeanceDateLabel(d.due_date) : (d.constraint_text || A_PLANIFIER_LABEL),
          toPlan: !d.due_date,
        }))
        .slice(0, DEADLINES_LIMIT)

      const site: SiteImpact = {
        siteId,
        siteName: overview.identity.name,
        synthesisStatus: overview.synthesis.status,
        deadlines,
        added: {
          actions: countKind(siteRows, 'action'),
          watchpoints: countKind(siteRows, 'watchpoint'),
          deadlines: countKind(siteRows, 'deadline'),
          stakeholders: countKind(siteRows, 'stakeholder'),
          knowledge: countKind(siteRows, 'knowledge'),
        },
        // « À traiter » = les propositions d'action de la fiche, mêmes titres.
        todo: overview.actions.proposed.slice(0, TODO_LIMIT),
        events,
        lastEventAt,
        sinceLabel: lastVisitAt
          ? `Depuis votre visite ${visitDateLabel(lastVisitAt).toLowerCase() === "aujourd'hui" ? "d'aujourd'hui" : visitDateLabel(lastVisitAt) === 'Hier' ? "d'hier" : `du ${visitDateLabel(lastVisitAt)}`}`
          : "Aujourd'hui",
      }
      return site
    }),
  )

  const kept = sites.filter((s): s is SiteImpact => s !== null)
  kept.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))

  // Ordre CHRONOLOGIQUE : « Visite terminée » puis « Synthèse créée » puis « 3 actions
  // proposées ». C'est une histoire — la lire à l'envers, c'est perdre le fait que
  // MemorIA a travaillé après le passage du conducteur. On garde les plus RÉCENTS
  // (fin de liste) quand il y en a trop, mais on les raconte dans l'ordre.
  const allEvents = kept
    .flatMap((s) => s.events.map((e) => ({ ...e, siteId: s.siteId, siteName: s.siteName })))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-EVENTS_LIMIT)

  return { sites: kept, events: allEvents }
}
