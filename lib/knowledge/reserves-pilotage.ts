import 'server-only'

// V1-3 — READ-MODEL « Réserves à piloter » (SUJET → réserve durable/CBO → occurrences).
//
// Problème résolu (roadmap V1-3) : arrêter de présenter N occurrences documentaires du MÊME problème
// comme N réserves métier distinctes. Sur RUS : 10 occurrences → 5 problèmes durables (5 CBO réserve).
//
// FRONTIÈRE FIGÉE : **aucun lifecycle réserve** dans ce lot. C2A est action-only ; le CBO réserve n'a
// PAS d'état autoritatif. On N'INVENTE PAS open/resolved/reopened au niveau réserve. Le statut brut
// d'une occurrence reste une information documentaire de CETTE occurrence, jamais un état durable.
// Réutilise l'identité CBO réserve existante (canonical_business_object object_type=site_reserve +
// canonical_business_object_member) ; aucune seconde logique de regroupement.

import { createAdminClient } from '@/lib/supabase/admin'

/** Occurrence documentaire brute d'une réserve (site_reserve). `status` = statut brut de preuve. */
export interface ReserveOccurrence {
  id: string
  label: string
  status: string
  reportId: string | null
}

/** Réserve durable = un CBO réserve. AUCUN état durable exposé (pas de computedCurrentState). */
export interface ReserveDurable {
  cboId: string
  label: string
  occurrenceCount: number
  pvCount: number
  occurrenceIds: string[]
}

export interface ReservePilotageSubject {
  canonicalSubjectId: string
  label: string
  reserves: ReserveDurable[]
  occurrenceCount: number
  pvCount: number
}

/** KPI : N sujets, N réserves durables (CBO), N occurrences. Ne JAMAIS présenter les occurrences
 *  comme des problèmes distincts, ni les durables comme « N ouvertes » (aucun lifecycle). */
export interface ReservesPilotageKpi {
  subjectsWithReserves: number
  durableReserves: number
  occurrences: number
}

export interface SiteReservesPilotage {
  kpi: ReservesPilotageKpi
  subjects: ReservePilotageSubject[]
}

export function emptyReservesPilotage(): SiteReservesPilotage {
  return { kpi: { subjectsWithReserves: 0, durableReserves: 0, occurrences: 0 }, subjects: [] }
}

// ── Assemblage PUR (aucune DB) ────────────────────────────────────────────────
export interface ReserveCboInput { cboId: string; label: string; canonicalSubjectId: string | null }
export interface ReserveRowInput { id: string; label: string; status: string; reportId: string | null; canonicalSubjectId: string | null }

/**
 * Compose la hiérarchie SUJET → réserve durable (CBO) → occurrences. Les occurrences sont rattachées
 * à un CBO par le membership ; une occurrence du sujet SANS membership CBO (dangling) est rattachée
 * au premier CBO réserve du même sujet (même problème durable), afin de ne perdre AUCUNE occurrence.
 * `durableReserves` (KPI) = nombre de CBO réserve. Déterministe.
 */
export function assembleReservesPilotage(
  reserveCbos: ReserveCboInput[],
  membershipByCbo: Map<string, string[]>, // cboId → occurrence(reserve) ids
  rows: ReserveRowInput[],
  subjectLabelById: Map<string, string>,
): SiteReservesPilotage {
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const cbosBySubject = new Map<string, ReserveCboInput[]>()
  for (const c of reserveCbos) {
    if (!c.canonicalSubjectId) continue
    const l = cbosBySubject.get(c.canonicalSubjectId) ?? []; l.push(c); cbosBySubject.set(c.canonicalSubjectId, l)
  }
  // occurrences déjà rattachées à un CBO (par membership)
  const attached = new Set<string>()
  for (const ids of membershipByCbo.values()) for (const id of ids) attached.add(id)

  const subjects: ReservePilotageSubject[] = []
  for (const [subjectId, cbos] of cbosBySubject) {
    const subjectRows = rows.filter((r) => r.canonicalSubjectId === subjectId)
    // occurrences du sujet sans membership CBO → rattachées au 1er CBO du sujet (même problème durable)
    const orphanIds = subjectRows.filter((r) => !attached.has(r.id)).map((r) => r.id)

    const reserves: ReserveDurable[] = cbos.map((c, i) => {
      const ids = [...(membershipByCbo.get(c.cboId) ?? [])]
      if (i === 0) ids.push(...orphanIds) // orphelins → premier CBO du sujet
      const occRows = ids.map((id) => rowById.get(id)).filter((r): r is ReserveRowInput => !!r)
      return {
        cboId: c.cboId, label: c.label,
        occurrenceCount: occRows.length,
        pvCount: new Set(occRows.map((r) => r.reportId).filter(Boolean)).size,
        occurrenceIds: ids,
      }
    })
    subjects.push({
      canonicalSubjectId: subjectId,
      label: subjectLabelById.get(subjectId) ?? cbos[0]?.label ?? '(sujet)',
      reserves,
      occurrenceCount: subjectRows.length,
      pvCount: new Set(subjectRows.map((r) => r.reportId).filter(Boolean)).size,
    })
  }
  subjects.sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.label.localeCompare(b.label))

  return {
    kpi: {
      subjectsWithReserves: subjects.length,
      durableReserves: reserveCbos.length,
      occurrences: rows.length,
    },
    subjects,
  }
}

export async function getSiteReservesPilotage(siteId: string): Promise<SiteReservesPilotage> {
  const sb = createAdminClient()
  const [cboRes, rowRes] = await Promise.all([
    sb.from('canonical_business_object').select('id, label, canonical_subject_id').eq('site_id', siteId).eq('object_type', 'site_reserve'),
    sb.from('site_reserve').select('id, label, status, report_id, canonical_subject_id').eq('site_id', siteId),
  ])
  const reserveCbos: ReserveCboInput[] = ((cboRes.data ?? []) as Array<{ id: string; label: string | null; canonical_subject_id: string | null }>)
    .map((c) => ({ cboId: c.id, label: c.label ?? '(réserve)', canonicalSubjectId: c.canonical_subject_id }))
  const rows: ReserveRowInput[] = ((rowRes.data ?? []) as Array<{ id: string; label: string | null; status: string; report_id: string | null; canonical_subject_id: string | null }>)
    .map((r) => ({ id: r.id, label: r.label ?? '(réserve)', status: r.status, reportId: r.report_id, canonicalSubjectId: r.canonical_subject_id }))
  if (reserveCbos.length === 0 && rows.length === 0) return emptyReservesPilotage()

  // membership CBO réserve → occurrences
  const membershipByCbo = new Map<string, string[]>()
  const cboIds = reserveCbos.map((c) => c.cboId)
  if (cboIds.length) {
    const { data } = await sb.from('canonical_business_object_member')
      .select('canonical_business_object_id, member_entity_id')
      .in('canonical_business_object_id', cboIds).eq('member_entity_type', 'site_reserve')
    for (const m of (data ?? []) as Array<{ canonical_business_object_id: string; member_entity_id: string }>) {
      const l = membershipByCbo.get(m.canonical_business_object_id) ?? []; l.push(m.member_entity_id); membershipByCbo.set(m.canonical_business_object_id, l)
    }
  }

  const subjIds = [...new Set([...reserveCbos.map((c) => c.canonicalSubjectId), ...rows.map((r) => r.canonicalSubjectId)].filter((x): x is string => !!x))]
  const subjectLabelById = new Map<string, string>()
  if (subjIds.length) {
    const { data } = await sb.from('canonical_subject').select('id, label').in('id', subjIds)
    for (const s of (data ?? []) as Array<{ id: string; label: string | null }>) if (s.label) subjectLabelById.set(s.id, s.label)
  }

  return assembleReservesPilotage(reserveCbos, membershipByCbo, rows, subjectLabelById)
}
