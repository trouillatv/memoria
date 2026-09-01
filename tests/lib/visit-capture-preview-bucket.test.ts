// Photos — résolution des previews par BUCKET (audit UX 2026-09-01).
//
// Deux populations de captures partagent la même table, mais leurs octets vivent
// dans deux buckets distincts :
//   • terrain natif          → bucket `site-reports` (préfixe report/site).
//   • images extraites de PV  → bucket `documents`, sous `snapshots/<documentId>/…`.
// Avant le fix, getVisitCapturePreviewUrls signait TOUT sur `site-reports` : les
// photos de PV (objets absents de ce bucket) renvoyaient une URL nulle → la
// galerie affichait « Aucune photo » alors que les captures existaient.
// Ces tests prouvent : chaque chemin est signé sur SON bucket, et les deux
// populations produisent une URL — réparer l'import ne casse pas le terrain.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Attachment = { id: string; storage_path: string; mime_type: string | null }

let attachments: Attachment[] = []
const signedByBucket: Record<string, string[]> = {}

const fakeClient = {
  from: (table: string) => {
    void table // même builder quelle que soit la table lue (on ne teste que la signature storage)
    return {
      select: () => ({
        in: async () => ({ data: attachments, error: null }),
      }),
    }
  },
  storage: {
    from: (bucket: string) => ({
      createSignedUrls: async (paths: string[]) => {
        signedByBucket[bucket] = (signedByBucket[bucket] ?? []).concat(paths)
        return {
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${bucket}/${p}` })),
          error: null,
        }
      },
    }),
  },
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient }))

const { getVisitCapturePreviewUrls } = await import('@/lib/db/visit-captures')

beforeEach(() => {
  attachments = []
  for (const k of Object.keys(signedByBucket)) delete signedByBucket[k]
})

describe('getVisitCapturePreviewUrls — chaque capture signée sur son bucket', () => {
  it('image de PV (snapshots/…) signée sur `documents`, capture terrain sur `site-reports`', async () => {
    attachments = [
      { id: 'att-import',  storage_path: 'snapshots/doc-1/img-p4-1.png', mime_type: null },
      { id: 'att-terrain', storage_path: 'report-uuid-1/photo-1.jpg',   mime_type: 'image/jpeg' },
    ]

    const out = await getVisitCapturePreviewUrls([
      { id: 'cap-import',  attachment_id: 'att-import' },
      { id: 'cap-terrain', attachment_id: 'att-terrain' },
    ])

    // Les DEUX populations résolvent une URL (le cœur de la régression Photos vide).
    expect(out['cap-import']?.url).toBe('https://signed/documents/snapshots/doc-1/img-p4-1.png')
    expect(out['cap-terrain']?.url).toBe('https://signed/site-reports/report-uuid-1/photo-1.jpg')

    // …et chaque chemin a bien été signé sur SON bucket, jamais l'autre.
    expect(signedByBucket['documents']).toEqual(['snapshots/doc-1/img-p4-1.png'])
    expect(signedByBucket['site-reports']).toEqual(['report-uuid-1/photo-1.jpg'])
  })

  it('chantier PV-only : les images importées ne sont plus filtrées (galerie non vide)', async () => {
    attachments = [
      { id: 'att-a', storage_path: 'snapshots/doc-1/img-p1-1.png', mime_type: null },
      { id: 'att-b', storage_path: 'snapshots/doc-1/img-p2-1.png', mime_type: null },
    ]

    const out = await getVisitCapturePreviewUrls([
      { id: 'cap-a', attachment_id: 'att-a' },
      { id: 'cap-b', attachment_id: 'att-b' },
    ])

    expect(Object.keys(out)).toHaveLength(2)
    expect(out['cap-a']?.url).toContain('/documents/')
    // Aucun appel de signature sur site-reports quand rien n'y vit.
    expect(signedByBucket['site-reports']).toBeUndefined()
  })

  it('terrain seul : comportement inchangé, signé sur site-reports', async () => {
    attachments = [{ id: 'att-t', storage_path: 'report-uuid-2/p.jpg', mime_type: 'image/jpeg' }]

    const out = await getVisitCapturePreviewUrls([{ id: 'cap-t', attachment_id: 'att-t' }])

    expect(out['cap-t']?.url).toBe('https://signed/site-reports/report-uuid-2/p.jpg')
    expect(signedByBucket['documents']).toBeUndefined()
  })
})

// ── DOCTRINE : le préfixe `snapshots/` est un CONTRAT de stockage, pas une ──────
// convention observée. Le producteur (extraction PV) écrit ses images dans le
// bucket `documents` sous `snapshots/<documentId>/…` ; le consommateur (résolveur
// de preview) DOIT router ce préfixe vers `documents`. Ces assertions figent la
// partition aux deux bouts : un futur « simplifions tout vers site-reports »
// (la régression d'origine) ou un déplacement de l'upload d'extraction casse ici,
// pas en production sur une galerie muette.

const CONSUMER = join(process.cwd(), 'lib/db/visit-captures.ts')
const PRODUCER = join(process.cwd(), 'lib/documents/extract-historical-pv.ts')

function bodyOf(file: string, name: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf(`export async function ${name}`)
  expect(start, `${name} est introuvable`).toBeGreaterThan(-1)
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('Contrat de stockage — snapshots/ ⇒ documents, terrain ⇒ site-reports', () => {
  const consumer = bodyOf(CONSUMER, 'getVisitCapturePreviewUrls')

  it('le résolveur partitionne sur le préfixe `snapshots/` et signe sur LES DEUX buckets', () => {
    expect(consumer, 'le discriminant de bucket doit rester le préfixe snapshots/').toContain("'snapshots/'")
    expect(consumer, 'les images de PV se signent sur le bucket documents').toContain("'documents'")
    expect(consumer, 'le terrain se signe sur le bucket site-reports').toContain("'site-reports'")
  })

  it('aucune signature mono-bucket de TOUS les chemins (garde anti-régression)', () => {
    // La forme d'origine `.from('site-reports').createSignedUrls(paths, …)` signait
    // l'ensemble des chemins sur un seul bucket → photos de PV muettes. On interdit
    // qu'un chemin non partitionné (`paths`) soit signé directement.
    expect(consumer).not.toMatch(/createSignedUrls\(\s*paths\b/)
  })

  it('le producteur d’extraction écrit bien sous `documents` + `snapshots/` (couplage figé)', () => {
    // Si quelqu'un déplace l'upload d'extraction ailleurs, le préfixe côté
    // consommateur ne suffira plus : ce test force à mettre à jour les deux bouts.
    const producer = readFileSync(PRODUCER, 'utf8')
    expect(producer).toContain("from('documents')")
    expect(producer).toContain('`snapshots/${documentId}/')
  })
})
