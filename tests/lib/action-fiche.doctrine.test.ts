import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Lot 4 · Slice 3 — la fiche Action lit UNE action, sûrement ───────────────
// getSiteActionFiche est un module `server-only` (DB) → on protège ses
// invariants par lecture de source (même pattern que site-intervenants-view).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/action-fiche.ts'), 'utf8')

describe('getSiteActionFiche — lecture canonique, fail-closed', () => {
  it('l’action est scopée au chantier (garde IDOR)', () => {
    expect(src).toMatch(/eq\('site_id', siteId\)/)
    expect(src).toMatch(/eq\('id', actionId\)/)
  })

  it('l’org du site est vérifiée (fail-closed, service-role bypasse la RLS)', () => {
    expect(src).toContain('getOrgId')
    expect(src).toContain('organization_id')
  })

  it('le responsable identifié vient de assigned_contact_id, jamais de assigned_to seul', () => {
    expect(src).toContain('assigned_contact_id')
    expect(src).toContain("kind: 'contact'")
    // assigned_to n'est qu'un repli « ancien suivi », jamais une personne.
    expect(src).toContain("kind: 'text'")
  })

  it('le retard ne compte jamais une action terminée ou annulée', () => {
    expect(src).toMatch(/status !== 'done'/)
    expect(src).toMatch(/status !== 'cancelled'/)
  })
})

describe('provenance STRUCTURELLE (Slice 5) — jamais inférée', () => {
  it('la source vient des colonnes FK via primaryProvenanceKind', () => {
    expect(src).toContain('primaryProvenanceKind')
  })

  it('les objets sources sont chargés scopés au chantier (garde IDOR)', () => {
    expect(src).toMatch(/site_reserve[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/subjects[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/site_reports[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/visit_capture[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('un objet source disparu → « Origine indisponible », jamais un faux lien', () => {
    expect(src).toContain('Origine indisponible')
    expect(src).toMatch(/href: null/)
  })
})

describe('historique CANONIQUE (Slice 6B) — lu, jamais reconstruit', () => {
  it('la chronologie vient de site_action_events, triée en SQL, scopée action+chantier', () => {
    expect(src).toMatch(/from\('site_action_events'\)/)
    expect(src).toMatch(/eq\('action_id', actionId\)[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/order\('occurred_at'/)
  })

  it('la composition passe par le module pur (jamais de reconstruction depuis l’état courant)', () => {
    expect(src).toContain('normalizeActionHistory')
    expect(src).toContain('groupHistoryByDay')
    expect(src).toContain('historyNoteFor')
  })
})

describe('preuves de RÉALISATION (Slice 7) — jamais l’origine, jamais ambiguës', () => {
  it('la preuve vient des traces de clôture (mig 107), pas de source_capture_id', () => {
    // Le bloc « proofs » lit completed_comment / completed_photo_path…
    expect(src).toMatch(/completed_comment/)
    expect(src).toMatch(/completed_photo_path/)
    // …tandis que source_capture_id reste une ORIGINE (provenance « capture »),
    // jamais une preuve d'exécution.
    expect(src).toMatch(/kind === 'capture' && a\.source_capture_id/)
  })

  it('preuve COURANTE seulement si l’action est terminée ; sinon clôture ANTÉRIEURE', () => {
    expect(src).toMatch(/a\.status === 'done'/)
    expect(src).toContain("scope: 'current'")
    expect(src).toContain("scope: 'previous'")
    // la clôture antérieure est datée par l'événement completed le plus récent, jamais inventée
    expect(src).toMatch(/reverse\(\)\.find\(\(e\) => e\.kind === 'completed'\)/)
  })

  it('photo servie par URL signée serveur (bucket privé) ; fichier disparu → indisponible', () => {
    expect(src).toContain('createSignedUrl')
    expect(src).toContain('intervention-photos')
    expect(src).toMatch(/missing: !url/)
  })

  it('action jamais clôturée → aucune preuve (pas de carte vide)', () => {
    // proofs reste null si status !== 'done' ET aucune trace de clôture.
    expect(src).toMatch(/let proofs: ActionFicheProofs \| null = null/)
  })
})

describe('« État actuel » + relations — dérivés, jamais inventés', () => {
  it('la checklist est calculée depuis responsible/source/échéance/clôture, pas un champ nouveau', () => {
    expect(src).toContain("label: 'Responsable affecté', done: !!responsible")
    expect(src).toContain("label: 'Origine identifiée', done: !!source")
    expect(src).toContain("label: 'Clôturée', done: a.status === 'done'")
  })

  it('les relations viennent de la provenance connue (site + source), jamais devinées', () => {
    expect(src).toMatch(/relations:\s*\[/)
    expect(src).toMatch(/source\?\.available && source\.href/)
  })
})

describe('« Ce qui a été observé » (Slice ②) — la capture PRÉCISE, jamais le report', () => {
  it('lit la capture déclencheuse par source_capture_id, scopée au chantier', () => {
    expect(src).toMatch(/from\('visit_capture'\)[\s\S]*?eq\('id', a\.source_capture_id\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('le texte vient de capture.body ; la photo est SIGNÉE (bucket privé), jamais un chemin brut', () => {
    expect(src).toContain('a.source_capture_id')
    expect(src).toMatch(/from\('site_report_attachments'\)/)
    expect(src).toMatch(/signProofPhoto\(db, path\)/)
  })

  it('jamais une photo « du même report » : on ne charge pas les captures par report_id ici', () => {
    // Le bloc observé s'ancre sur la capture unique, pas sur une liste par report.
    expect(src).not.toMatch(/visit_capture'\)[\s\S]{0,200}in\('report_id'/)
  })
})
