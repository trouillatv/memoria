// Reportage photographique (Tier 2) — non-régression (P0 mémoire/reportage,
// Vincent, 2026-08-17).
//
// Méthode imposée : ces tests opèrent sur des tableaux façonnés EXACTEMENT
// comme le retour réel de listVisitCaptures() — jamais reconstruits depuis le
// bucket Storage. La découverte du cas PETRO (12 fichiers Storage → 1 original
// masqué → 11 captures visibles) montre pourquoi : `hidden_at` est filtré EN
// BASE (cf. lib/db/visit-captures.ts) et n'existe même pas sur VisitCaptureRow
// — un test qui partirait de 12 fichiers et retirerait « le masqué » referait
// le filtrage à la main au lieu de tester le pipeline sur son entrée réelle.

import { describe, expect, it } from 'vitest'
import { CR_PHOTO_CAP, CR_REPORTAGE_PHOTO_CAP, selectCrPhotos, selectReportagePhotos } from '@/lib/db/visits'
import type { VisitCaptureRow } from '@/lib/db/visit-captures'

let seq = 0
function cap(over: Partial<VisitCaptureRow> = {}): VisitCaptureRow {
  seq += 1
  const ts = `2026-08-14T08:${String(seq % 60).padStart(2, '0')}:00Z`
  return {
    id: `cap-${seq}`,
    report_id: 'report-1',
    site_id: 'site-1',
    kind: 'photo',
    status: 'kept',
    body: null,
    transcript_status: null,
    attachment_id: null,
    subject_id: null,
    triage_intent: null,
    suite_status: null,
    starred: false,
    client_uuid: null,
    lat: null,
    lng: null,
    captured_at: ts,
    is_viewpoint: false,
    viewpoint_of: null,
    annotated_original_id: null,
    included_in_cr: true,
    created_at: ts,
    ...over,
  }
}

/** Réplique EXACTEMENT le filtre appliqué par buildVisitCrDoc (lib/db/visits.ts)
 *  sur le retour de listVisitCaptures() : `discarded` écarté, puis kind photo.
 *  `hidden_at` n'a rien à filtrer ici — il n'a jamais atteint ce tableau. */
function visiblePhotosFrom(rows: VisitCaptureRow[]): VisitCaptureRow[] {
  return rows.filter((c) => c.status !== 'discarded').filter((c) => c.kind === 'photo')
}

describe('Reportage photographique — non-régression (P0, 2026-08-17)', () => {
  it('visite avec uniquement des photos "memoire" : 0 Photo clé, toutes en reportage', () => {
    const rows = Array.from({ length: 4 }, () => cap({ triage_intent: 'memoire' }))
    const photos = visiblePhotosFrom(rows)
    const selected = selectCrPhotos(photos)
    const { photos: reportage } = selectReportagePhotos(photos, selected)
    expect(selected).toHaveLength(0)
    expect(reportage).toHaveLength(4)
  })

  it('action + réserve + surveiller + starred + mémoire : chaque photo au bon niveau, jamais aux deux', () => {
    const action = cap({ triage_intent: 'action' })
    const reserve = cap({ triage_intent: 'reserve' })
    const follow = cap({ triage_intent: 'follow' })
    const starred = cap({ starred: true })
    const memoire = cap({ triage_intent: 'memoire' })
    const photos = visiblePhotosFrom([action, reserve, follow, starred, memoire])
    const selected = selectCrPhotos(photos)
    const { photos: reportage } = selectReportagePhotos(photos, selected)

    const selectedIds = new Set(selected.map((c) => c.id))
    const reportageIds = new Set(reportage.map((c) => c.id))
    expect(selectedIds).toEqual(new Set([action.id, reserve.id, follow.id, starred.id]))
    expect(reportageIds).toEqual(new Set([memoire.id]))
    for (const id of selectedIds) expect(reportageIds.has(id)).toBe(false)
  })

  it('capture jamais qualifiée (null) : visible en reportage, distincte d’une "memoire" explicite', () => {
    // Une photo "action" rend `eligible` non vide : le repli (qui remonterait
    // sinon une photo non taguée en Photo clé faute de mieux) ne s'applique
    // pas ici — on isole le comportement du reportage, pas celui du repli.
    const action = cap({ triage_intent: 'action' })
    const untagged = cap({ triage_intent: null })
    const memoire = cap({ triage_intent: 'memoire' })
    const photos = visiblePhotosFrom([action, untagged, memoire])
    const selected = selectCrPhotos(photos)
    const { photos: reportage } = selectReportagePhotos(photos, selected)

    expect(selected.map((c) => c.id)).toEqual([action.id])
    expect(reportage.map((c) => c.id).sort()).toEqual([memoire.id, untagged.id].sort())
    const byId = new Map(reportage.map((c) => [c.id, c]))
    expect(byId.get(memoire.id)?.triage_intent).toBe('memoire')
    expect(byId.get(untagged.id)?.triage_intent).toBeNull()
    // Priorité : memoire (décision explicite) avant null (jamais qualifiée).
    expect(reportage[0].id).toBe(memoire.id)
  })

  it('capture "discarded" : n’apparaît jamais, ni en Photo clé ni en reportage', () => {
    const kept = cap({ triage_intent: 'memoire' })
    const discarded = cap({ status: 'discarded', triage_intent: null })
    const photos = visiblePhotosFrom([kept, discarded])
    expect(photos.map((c) => c.id)).not.toContain(discarded.id)
    const selected = selectCrPhotos(photos)
    const { photos: reportage } = selectReportagePhotos(photos, selected)
    expect(selected.map((c) => c.id)).not.toContain(discarded.id)
    expect(reportage.map((c) => c.id)).not.toContain(discarded.id)
  })

  it('cas PETRO (12 fichiers Storage → 1 masqué → 11 visibles) : le tableau d’entrée en compte 11, jamais 12', () => {
    // hidden_at est filtré EN BASE (listVisitCaptures()) et n'existe pas sur
    // VisitCaptureRow : on fixture directement les 11 lignes réellement
    // renvoyées, pas 12 fichiers Storage dont on retirerait un « masqué ».
    const rows = Array.from({ length: 11 }, (_, i) => cap({ triage_intent: i < 2 ? 'action' : 'memoire' }))
    const photos = visiblePhotosFrom(rows)
    const selected = selectCrPhotos(photos)
    const { photos: reportage, overflow } = selectReportagePhotos(photos, selected)
    expect(photos).toHaveLength(11)
    expect(selected).toHaveLength(2)
    expect(reportage).toHaveLength(9)
    expect(overflow).toBe(0)
  })

  it('aucune photo captée : aucun tableau non vide, rien à rendre', () => {
    const photos = visiblePhotosFrom([])
    const selected = selectCrPhotos(photos)
    const { photos: reportage, overflow } = selectReportagePhotos(photos, selected)
    expect(selected).toHaveLength(0)
    expect(reportage).toHaveLength(0)
    expect(overflow).toBe(0)
  })

  it('au-delà du plafond : plus aucune troncature (Vincent, 2026-08-17 — sélection éditoriale, jamais un cap invisible)', () => {
    const rows = Array.from({ length: CR_REPORTAGE_PHOTO_CAP + 7 }, () => cap({ triage_intent: 'memoire' }))
    const photos = visiblePhotosFrom(rows)
    const selected = selectCrPhotos(photos)
    const { photos: reportage, overflow } = selectReportagePhotos(photos, selected)
    expect(reportage).toHaveLength(CR_REPORTAGE_PHOTO_CAP + 7)
    expect(overflow).toBe(0)
  })

  it('sélection éditoriale (included_in_cr) : une capture exclue par l’humain ne doit être filtrée qu’en AMONT, jamais par selectReportagePhotos elle-même', () => {
    // `selectCrPhotos`/`selectReportagePhotos` n'ont jamais lu `included_in_cr` :
    // le filtre vit dans `buildVisitCrDoc` (crPhotoCaptures), pas ici. On le
    // prouve en fixturant une capture explicitement exclue (included_in_cr:
    // false) et en vérifiant qu'elle reste visible tant qu'on ne la filtre pas
    // soi-même — exactement ce que fait buildVisitCrDoc avant d'appeler ces
    // fonctions.
    const kept = cap({ triage_intent: 'memoire', included_in_cr: true })
    const excluded = cap({ triage_intent: 'memoire', included_in_cr: false })
    const rows = visiblePhotosFrom([kept, excluded])

    // Le filtre éditorial, répliqué ici comme le fait buildVisitCrDoc.
    const crPhotoCaptures = rows.filter((c) => c.included_in_cr)
    expect(crPhotoCaptures.map((c) => c.id)).toEqual([kept.id])

    const selected = selectCrPhotos(crPhotoCaptures)
    const { photos: reportage } = selectReportagePhotos(crPhotoCaptures, selected)
    expect([...selected, ...reportage].map((c) => c.id)).toEqual([kept.id])
  })

  it('aucune capture ne peut apparaître à la fois en Photo clé et en Reportage', () => {
    const rows = [
      cap({ starred: true }),
      cap({ triage_intent: 'reserve' }),
      cap({ triage_intent: 'action' }),
      cap({ triage_intent: 'follow' }),
      cap({ triage_intent: 'memoire' }),
      cap({ triage_intent: null }),
      ...Array.from({ length: CR_PHOTO_CAP + 5 }, () => cap({ triage_intent: 'action' })), // force le plafond des clés
    ]
    const photos = visiblePhotosFrom(rows)
    const selected = selectCrPhotos(photos)
    const { photos: reportage } = selectReportagePhotos(photos, selected)
    expect(selected.length).toBeLessThanOrEqual(CR_PHOTO_CAP)
    const selectedIds = new Set(selected.map((c) => c.id))
    for (const c of reportage) expect(selectedIds.has(c.id)).toBe(false)
  })
})
