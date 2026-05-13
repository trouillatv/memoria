// Sprint 4 PC — Préparation calme pour chefs d'équipe (Doctrine V5).
//
// « NetoIAge prépare le plateau. L'humain (Maeva) choisit de servir. »
//
// Pour une date donnée (typiquement demain), construit la PRÉPARATION envoyée
// individuellement par Maeva à chaque chef d'équipe via WhatsApp 1-à-1. Trois
// blocs descriptifs :
//   - passages : interventions du chef d'équipe (heure + site + libellé court)
//   - aSavoir  : notes de site récentes sur les sites concernés (verrou V4)
//   - continuite : compteurs factuels de stabilité par contrat concerné
//
// Doctrine V5 (verrous critiques) :
//   - Verrou V4 : aucune formulation de contrôle. Format passif descriptif.
//     ✅ « Bloc B : humidité signalée hier »   ❌ « Pense à vérifier le bloc B »
//   - Maxim 9   : pour envoi WhatsApp 1-à-1 (jamais groupe collectif).
//   - Verrou V6 : aucun timestamp d'envoi persisté côté DB. La date "demain"
//     n'est PAS persistée — c'est un calcul à la volée.
//   - Pilier 5  : descriptif uniquement. Pas un dashboard de surveillance.
//
// Hors-scope : aucune mesure d'humain, aucun score, aucun classement. Le
// `userId` d'un chef d'équipe n'apparaît jamais dans une comparaison.

import { createAdminClient } from '@/lib/supabase/admin'
import type { InterventionSlot, DbSiteNote } from '@/types/db'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ChefEquipePassage {
  /** Heure formatée FR ("7h", "14h", "19h"). Dérivée du slot. */
  time: string
  /** Nom du site (verbatim DB). */
  siteName: string
  /** Libellé court de la mission (mission.name tronqué si besoin). */
  missionShortLabel: string
}

export interface ChefEquipePreparation {
  userId: string
  userFullName: string
  /** E.164 ou null si non renseigné. UI : bouton désactivé tant que null. */
  userPhone: string | null
  /** Date ciblée yyyy-mm-dd (typiquement demain). */
  forDate: string
  blocks: {
    passages: ChefEquipePassage[]
    /** Notes de site récentes, déjà filtrées passif descriptif (verrou V4). Max 5. */
    aSavoir: string[]
    /** Compteurs continuité par contrat concerné. Max 2 lignes. */
    continuite: string[]
    /** Infos d'accès par site (code entrée, contact, horaires…). Format passif,
     *  une ligne par site concerné. Silencieux si aucun champ renseigné. */
    accesInfos: string[]
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function slotToTimeFr(slot: InterventionSlot | null): string {
  // Convention métier : créneaux nommés, pas d'horaires précis. On affiche
  // l'heure de référence du slot (cf. lib/db/intervention-templates.ts).
  switch (slot) {
    case 'morning':
      return '7h'
    case 'afternoon':
      return '14h'
    case 'evening':
      return '19h'
    default:
      return '—'
  }
}

/**
 * Filtre verrou V4 : rejette les notes qui ressemblent à du wording de contrôle.
 * Une note de site ne devrait jamais avoir été créée avec ces verbes (la doctrine
 * est appliquée côté UI), mais ce filtre est un filet de sécurité passive avant
 * que le texte parte sur WhatsApp.
 */
const FORBIDDEN_CONTROL_RE =
  /(pense\s*à|n[''’]?oublie\s*pas|tu\s+dois|merci\s+de|attention\s+à|fais\s+attention|fait\s+attention)/i

function passesControlFilter(text: string): boolean {
  return !FORBIDDEN_CONTROL_RE.test(text)
}

/** Tronque le libellé mission pour rester compact dans le message WhatsApp. */
function shortMissionLabel(name: string): string {
  const trimmed = (name ?? '').trim()
  if (trimmed.length <= 40) return trimmed
  return trimmed.slice(0, 37) + '…'
}

// ----------------------------------------------------------------------------
// Helper principal
// ----------------------------------------------------------------------------

/**
 * Pour chaque chef d'équipe ayant au moins une intervention prévue à `forDate`,
 * génère sa préparation (3 blocs).
 *
 * Important — Doctrine V3 (asymétrie événement vs personne) :
 *   - On parcourt les EVENT (intervention.team contient userId) pour grouper
 *     par chef d'équipe. Ce regroupement reste OPÉRATIONNEL (préparer demain)
 *     et n'est jamais persisté en DB. Aucun "historique de Pierre" n'est créé.
 *   - Seuls les utilisateurs `role = chef_equipe` non supprimés sont retenus.
 */
export async function generateChefEquipePreparations(
  forDate: string,
): Promise<ChefEquipePreparation[]> {
  const supabase = createAdminClient()

  // 1) Toutes les interventions planifiées (planned / in_progress) à la date cible.
  const { data: interventions, error: iErr } = await supabase
    .from('interventions')
    .select(
      `id, slot, team,
       mission:missions!inner(
         id, name,
         site:sites!inner(id, name, contract_id)
       )`,
    )
    .eq('scheduled_for', forDate)
    .in('status', ['planned', 'in_progress'])
  if (iErr) throw iErr

  type Row = {
    id: string
    slot: InterventionSlot | null
    team: string[] | null
    mission:
      | { id: string; name: string; site: { id: string; name: string; contract_id: string | null } | { id: string; name: string; contract_id: string | null }[] | null }
      | Array<{ id: string; name: string; site: { id: string; name: string; contract_id: string | null } | { id: string; name: string; contract_id: string | null }[] | null }>
      | null
  }

  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (v === null || v === undefined) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  const rows = (interventions ?? []) as Row[]
  if (rows.length === 0) return []

  // 2) Tous les userIds qui apparaissent dans au moins une `team[]`.
  const userIdSet = new Set<string>()
  for (const r of rows) {
    for (const uid of r.team ?? []) {
      if (typeof uid === 'string' && uid.length > 0) userIdSet.add(uid)
    }
  }
  if (userIdSet.size === 0) return []

  // 3) Charger les chef d'équipe parmi ces userIds (filtre rôle + non supprimés).
  const { data: usersData, error: uErr } = await supabase
    .from('users')
    .select('id, full_name, role, phone, deleted_at')
    .in('id', Array.from(userIdSet))
    .eq('role', 'chef_equipe')
    .is('deleted_at', null)
  if (uErr) throw uErr

  type DbUserRow = {
    id: string
    full_name: string | null
    role: string
    phone: string | null
    deleted_at: string | null
  }
  const chefById = new Map<string, DbUserRow>()
  for (const u of (usersData ?? []) as DbUserRow[]) chefById.set(u.id, u)
  if (chefById.size === 0) return []

  // 4) Grouper par chef d'équipe → liste de passages.
  type Passage = ChefEquipePassage & {
    siteId: string
    contractId: string | null
  }
  const passagesByChef = new Map<string, Passage[]>()

  for (const r of rows) {
    const mission = pickOne(r.mission)
    if (!mission) continue
    const site = pickOne(mission.site)
    if (!site) continue
    for (const uid of r.team ?? []) {
      if (!chefById.has(uid)) continue
      const arr = passagesByChef.get(uid) ?? []
      arr.push({
        time: slotToTimeFr(r.slot),
        siteName: site.name,
        missionShortLabel: shortMissionLabel(mission.name),
        siteId: site.id,
        contractId: site.contract_id,
      })
      passagesByChef.set(uid, arr)
    }
  }

  if (passagesByChef.size === 0) return []

  // 5) Pré-charger les site_notes récentes (≤ 30 jours) pour les sites concernés.
  //    On filtre côté doctrine V4 et tronque à 5 max.
  const allSiteIds = new Set<string>()
  for (const list of passagesByChef.values()) {
    for (const p of list) allSiteIds.add(p.siteId)
  }
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  let siteNotes: DbSiteNote[] = []
  if (allSiteIds.size > 0) {
    const { data: notes, error: nErr } = await supabase
      .from('site_notes')
      .select('*')
      .in('site_id', Array.from(allSiteIds))
      .is('deleted_at', null)
      .gte('created_at', thirtyDaysAgoIso)
      .order('created_at', { ascending: false })
    if (nErr) throw nErr
    siteNotes = (notes ?? []) as DbSiteNote[]
  }
  const notesBySite = new Map<string, DbSiteNote[]>()
  for (const n of siteNotes) {
    const arr = notesBySite.get(n.site_id) ?? []
    arr.push(n)
    notesBySite.set(n.site_id, arr)
  }

  // 5.b) Pré-charger les champs structurés "fiche site" pour les sites
  // concernés. Format passif (code, contact, horaires), descriptif uniquement.
  type SiteAccessRow = {
    id: string
    access_code: string | null
    alarm_code: string | null
    contact_name: string | null
    contact_phone: string | null
    access_hours: string | null
  }
  const accessBySite = new Map<string, Omit<SiteAccessRow, 'id'>>()
  if (allSiteIds.size > 0) {
    const { data: accessRows } = await supabase
      .from('sites')
      .select(
        'id, access_code, alarm_code, contact_name, contact_phone, access_hours',
      )
      .in('id', Array.from(allSiteIds))
    for (const a of (accessRows ?? []) as SiteAccessRow[]) {
      const { id, ...rest } = a
      accessBySite.set(id, rest)
    }
  }

  function buildAccessLine(
    siteName: string,
    a: Omit<SiteAccessRow, 'id'> | undefined,
  ): string | null {
    if (!a) return null
    const parts: string[] = []
    if (a.access_code) parts.push(`code ${a.access_code}`)
    if (a.alarm_code) parts.push(`alarme ${a.alarm_code}`)
    if (a.contact_name && a.contact_phone) {
      parts.push(`${a.contact_name} ${a.contact_phone}`)
    } else if (a.contact_phone) {
      parts.push(a.contact_phone)
    } else if (a.contact_name) {
      parts.push(a.contact_name)
    }
    if (a.access_hours) parts.push(a.access_hours)
    if (parts.length === 0) return null
    return `${siteName} : ${parts.join(' · ')}`
  }

  // 6) Pré-charger les compteurs continuité par contrat concerné (lazy import).
  //    On regroupe par contractId pour ne lancer qu'un getContractContinuity par
  //    contrat (déduplication). Les contractId null sont ignorés.
  const allContractIds = new Set<string>()
  for (const list of passagesByChef.values()) {
    for (const p of list) {
      if (p.contractId) allContractIds.add(p.contractId)
    }
  }
  const continuityByContract = new Map<string, { name: string; line: string }>()
  if (allContractIds.size > 0) {
    const { getContractContinuity } = await import('@/lib/db/contracts')
    // Récupère les noms de contrats en un seul query.
    const { data: contractRows } = await supabase
      .from('contracts')
      .select('id, name')
      .in('id', Array.from(allContractIds))
      .is('deleted_at', null)
    const contractNameById = new Map<string, string>()
    for (const c of (contractRows ?? []) as Array<{ id: string; name: string }>) {
      contractNameById.set(c.id, c.name)
    }
    for (const cid of allContractIds) {
      try {
        const cc = await getContractContinuity(cid)
        if (!cc) continue
        const name = contractNameById.get(cid) ?? cid.slice(0, 6)
        // Format passif descriptif uniquement (verrou V4).
        // Préférence : "N passages consécutifs sans rupture" si totalExecuted > 0.
        if (cc.totalExecutedInterventions > 0 && cc.weeksWithoutInterruption > 0) {
          continuityByContract.set(cid, {
            name,
            line: `${name} : ${cc.totalExecutedInterventions} passages consécutifs sans rupture`,
          })
        } else if (cc.totalExecutedInterventions > 0) {
          continuityByContract.set(cid, {
            name,
            line: `${name} : ${cc.totalExecutedInterventions} passages enregistrés`,
          })
        }
      } catch {
        // continuity facultatif — on n'échoue pas la préparation entière.
      }
    }
  }

  // 7) Construire la sortie. Tri stable :
  //    - chefs par nom alpha
  //    - passages par heure (slot order morning < afternoon < evening)
  const SLOT_ORDER: Record<string, number> = { '7h': 0, '14h': 1, '19h': 2, '—': 3 }

  const result: ChefEquipePreparation[] = []
  for (const [userId, passages] of passagesByChef) {
    const chef = chefById.get(userId)
    if (!chef) continue

    passages.sort((a, b) => (SLOT_ORDER[a.time] ?? 9) - (SLOT_ORDER[b.time] ?? 9))

    // À savoir : notes uniques par body, max 5, filtre verrou V4.
    const concernedSiteIds = new Set(passages.map((p) => p.siteId))
    const aSavoirRaw: string[] = []
    const seenBodies = new Set<string>()
    for (const sid of concernedSiteIds) {
      const notes = notesBySite.get(sid) ?? []
      const siteName = passages.find((p) => p.siteId === sid)?.siteName ?? ''
      for (const n of notes) {
        const body = (n.body ?? '').trim()
        if (!body) continue
        if (!passesControlFilter(body)) continue
        const composed = `${siteName} : ${body}`
        if (seenBodies.has(composed)) continue
        seenBodies.add(composed)
        aSavoirRaw.push(composed)
        if (aSavoirRaw.length >= 5) break
      }
      if (aSavoirRaw.length >= 5) break
    }

    // Continuité : 2 lignes max, contrats les plus présents en premier.
    const concernedContractIds = new Set(
      passages.map((p) => p.contractId).filter((c): c is string => Boolean(c)),
    )
    const continuiteLines: string[] = []
    for (const cid of concernedContractIds) {
      const c = continuityByContract.get(cid)
      if (c) continuiteLines.push(c.line)
      if (continuiteLines.length >= 2) break
    }

    // Accès : une ligne par site concerné dont au moins un champ est rempli.
    const accesInfos: string[] = []
    const seenSites = new Set<string>()
    for (const p of passages) {
      if (seenSites.has(p.siteId)) continue
      seenSites.add(p.siteId)
      const line = buildAccessLine(p.siteName, accessBySite.get(p.siteId))
      if (line) accesInfos.push(line)
    }

    result.push({
      userId,
      userFullName: chef.full_name ?? '—',
      userPhone: chef.phone ?? null,
      forDate,
      blocks: {
        passages: passages.map((p) => ({
          time: p.time,
          siteName: p.siteName,
          missionShortLabel: p.missionShortLabel,
        })),
        aSavoir: aSavoirRaw,
        continuite: continuiteLines,
        accesInfos,
      },
    })
  }

  result.sort((a, b) =>
    a.userFullName.localeCompare(b.userFullName, 'fr', { sensitivity: 'base' }),
  )
  return result
}

/** "demain" en UTC yyyy-mm-dd. */
export function tomorrowUtcIso(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
