import 'server-only'

// ── READ MODEL : CE QUI A CHANGÉ AUJOURD'HUI ─────────────────────────────────
// L'accueil ne pose qu'une question : « qu'est-ce qui a bougé, et qu'est-ce que je
// dois faire ? ». Ce read model y répond — il ne raconte rien d'autre.
//
// LA RÈGLE, non négociable : les NOMBRES viennent de `getSiteOverview`, le même
// read model que la fiche chantier. Jamais d'un compte SQL parallèle. Deux chemins
// = deux vérités : la fiche dirait « 3 actions proposées » et l'accueil « 2 », et
// plus personne ne croirait ni l'un ni l'autre. Le repository ne sert ici qu'à
// DÉCOUVRIR quels chantiers ont bougé et à quelle heure.
//
// « Aujourd'hui » = la journée civile à Nouméa. Pas celle du serveur.

import { getSiteOverview, type KnowledgeItem, type SynthesisStatus } from '@/lib/knowledge/site-overview'
import { readDayEvents, type DayEventRow } from '@/lib/knowledge/repository'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'

/** Un fait daté, dit avec les mots du conducteur. « 11:57 · Visite terminée ». */
export interface ChangeEvent {
  id: string
  at: string
  label: string
}

/** Ce qu'un chantier a produit aujourd'hui. Les compteurs sont ceux de sa fiche. */
export interface SiteChangedToday {
  siteId: string
  siteName: string
  synthesisStatus: SynthesisStatus
  /** Ce que la visite a fait APPARAÎTRE aujourd'hui (des ajouts, pas des stocks). */
  added: { actions: number; watchpoints: number; deadlines: number; stakeholders: number; knowledge: number }
  /** Les premiers titres — « à traiter » se lit, ne se compte pas. */
  todo: KnowledgeItem[]
  events: ChangeEvent[]
  /** Le fait le plus récent : donne la sensation de mouvement (« il y a 15 min »). */
  lastEventAt: string
}

export interface TodayChanges {
  sites: SiteChangedToday[]
  /** Tous les faits du jour, chantiers confondus, du plus récent au plus ancien. */
  events: Array<ChangeEvent & { siteId: string; siteName: string }>
}

const TODO_LIMIT = 3
const EVENTS_LIMIT = 8

export function emptyTodayChanges(): TodayChanges {
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
function buildEvents(rows: DayEventRow[]): ChangeEvent[] {
  const out: ChangeEvent[] = []
  for (const r of rows) {
    if (r.kind === 'visit_ended') out.push({ id: `visit-${r.at}`, at: r.at, label: 'Visite terminée' })
    if (r.kind === 'synthesis_created') out.push({ id: `synth-${r.at}`, at: r.at, label: 'Synthèse créée' })
  }
  // Les propositions d'un même type arrivent en rafale (une analyse) : on les
  // regroupe sur l'instant de la dernière — « 3 actions proposées », un fait.
  const byKind = new Map<string, DayEventRow[]>()
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
  const confirmedByKind = new Map<string, DayEventRow[]>()
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

function countKind(rows: DayEventRow[], kind: string): number {
  return rows.filter((r) => r.kind === 'proposal_created' && r.proposal_kind === kind).length
}

/**
 * Les chantiers qui ont bougé aujourd'hui, avec ce que leur visite a produit.
 * Silence total quand rien n'a bougé : un accueil qui invente du mouvement ment.
 */
export async function getTodayChanges(): Promise<TodayChanges> {
  const orgId = await getOrgId()
  const rows = await readDayEvents(todayLocalIso(), orgId).catch(() => [] as DayEventRow[])
  if (rows.length === 0) return emptyTodayChanges()

  const bySite = new Map<string, DayEventRow[]>()
  for (const r of rows) {
    const list = bySite.get(r.site_id) ?? []
    list.push(r)
    bySite.set(r.site_id, list)
  }

  // UN getSiteOverview par chantier RÉELLEMENT touché — donc les mêmes nombres
  // que sa fiche, par construction. Borné à ce qui a bougé, pas au portefeuille.
  const sites = await Promise.all(
    [...bySite.entries()].map(async ([siteId, siteRows]) => {
      const overview = await getSiteOverview(siteId).catch(() => null)
      if (!overview) return null
      const events = buildEvents(siteRows)
      const lastEventAt = events.length > 0 ? events[events.length - 1].at : siteRows[0].at
      const site: SiteChangedToday = {
        siteId,
        siteName: overview.identity.name,
        synthesisStatus: overview.synthesis.status,
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
      }
      return site
    }),
  )

  const kept = sites.filter((s): s is SiteChangedToday => s !== null)
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
