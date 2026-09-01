import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Lot 4 · Slice 3 — la fiche Action lit UNE action, sûrement ───────────────
// getSiteActionFiche est un module `server-only` (DB) → on protège ses
// invariants par lecture de source (même pattern que site-intervenants-view).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/action-fiche.ts'), 'utf8')
// Point 13A — le composant desktop porte le rendu conditionnel de l'encart sujet.
const fiche = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/views/action/ActionFiche.tsx'), 'utf8')

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

describe('« Issue de la décision » — lookup INVERSE (le pivot)', () => {
  it('la décision d’origine vient de site_decisions.action_id = cette action, scopée au chantier', () => {
    expect(src).toMatch(/from\('site_decisions'\)[\s\S]*?eq\('action_id', actionId\)[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toContain('fromDecision')
    // Adresse canonique depuis la migration — plus de paramètre de provenance.
    expect(src).toContain('/decision/${(dec as { id: string }).id}')
    expect(src).not.toContain('decision_source=')
  })
})

describe('« État actuel » + relations — dérivés, jamais inventés', () => {
  it('la checklist est calculée depuis responsible/source/échéance/clôture, pas un champ nouveau', () => {
    expect(src).toContain("label: 'Responsable affecté', done: !!responsible")
    expect(src).toContain("label: 'Origine identifiée', done: !!source")
    expect(src).toContain("label: 'Action clôturée', done: a.status === 'done'")
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

describe('Point 13A — contexte du SUJET canonique (desktop, conditionnel, source unique canonical-attention)', () => {
  it('opt-in DESKTOP : subjectContext calculé seulement si withSubjectContext ET canonical_subject_id', () => {
    expect(src).toMatch(/opts:\s*\{\s*withSubjectContext\?:\s*boolean\s*\}/)
    expect(src).toMatch(/if \(opts\.withSubjectContext && canonicalSubjectId\)/)
  })

  it('LADDER : libellé depuis canonical_subject (existe même sans signal) ; lien vers la vie EXISTANTE', () => {
    // le libellé est autoritatif (table sujet), pas seulement l'item d'attention
    expect(src).toMatch(/from\('canonical_subject'\)[\s\S]*?eq\('id', canonicalSubjectId\)[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/label: \(cs as \{ label: string \}\)\.label/)
    // lien = route de vie du sujet existante (même que canonical-attention subjectHref), jamais inventée
    expect(src).toContain('/historique/sujets/${canonicalSubjectId}')
  })

  it('RAISON = source UNIQUE canonical-attention (même moteur que « À surveiller »), optionnelle', () => {
    expect(src).toContain('deriveCanonicalAttentionItems')
    expect(src).toMatch(/attentionItems\.find\(\(i\) => i\.canonicalSubjectId === canonicalSubjectId\)/)
    // évolution = 1 ligne, seulement SI le moteur en porte une (item optionnel → null sinon)
    expect(src).toMatch(/evolution: item\?\.reasons\[0\] \?\? null/)
  })

  it('badge « Rouvert » JAMAIS une décoration anticipée : dérivé STRICTEMENT du signal, défaut false', () => {
    // data : reopened = signal réel ?? false (pas de vrai signal → false)
    expect(src).toMatch(/reopened: item\?\.signals\.includes\('pv_reopened'\) \?\? false/)
    // render : le badge n'est rendu que si reopened est vrai
    expect(fiche).toMatch(/subjectContext\.reopened &&/)
    expect(fiche).toContain('Rouvert')
  })

  it('réserve = COMPTE factuel « sur ce sujet » (coappartenance, jamais causal, jamais compteur d’actions)', () => {
    // on compte les réserves OUVERTES du même sujet — jamais site_actions (auto-référence/bruit),
    // jamais site_deadlines dans cet encart (resserrement audit)
    expect(src).toMatch(/from\('site_reserve'\)[\s\S]*?eq\('canonical_subject_id', canonicalSubjectId\)[\s\S]*?eq\('status', 'open'\)/)
    expect(src).toMatch(/reservesOnSubject:/)
    // pas d'échéance dans l'encart sujet (resserrement audit : réserves seules)
    expect(src).not.toMatch(/canonical_subject_id', canonicalSubjectId\)[\s\S]{0,120}from\('site_deadlines'\)/)
    // render : ligne conditionnée au compte, formulation « … sur ce sujet »
    expect(fiche).toMatch(/subjectContext\.reservesOnSubject > 0/)
    expect(fiche).toContain('sur ce sujet')
    expect(fiche).toContain('réserve')
  })

  it('pas une mini-fiche, pas de provenance dupliquée : jamais getCanonicalSubjectLife', () => {
    expect(src).not.toContain('getCanonicalSubjectLife')
    // la provenance (7A) n'est pas recopiée dans l'encart sujet
    expect(fiche).not.toMatch(/Contexte du sujet[\s\S]{0,400}subjectContext\.source/)
  })
})

describe('Point 13A — mobile strictement inchangé (13B plus tard)', () => {
  const mobilePage = readFileSync(join(process.cwd(), 'app/(field)/m/site/[siteId]/action/[actionId]/page.tsx'), 'utf8')
  it('la page action mobile n’active PAS withSubjectContext (aucune requête d’attention, aucun encart)', () => {
    expect(mobilePage).toContain('getSiteActionFiche(siteId, actionId)')
    expect(mobilePage).not.toContain('withSubjectContext')
  })
})

describe('Point 13 — mobile strictement inchangé', () => {
  const mobilePage = readFileSync(join(process.cwd(), 'app/(field)/m/site/[siteId]/action/[actionId]/page.tsx'), 'utf8')
  it('la page action mobile n’active PAS withSubjectContext (aucune requête d’attention, aucun encart)', () => {
    expect(mobilePage).toContain('getSiteActionFiche(siteId, actionId)')
    expect(mobilePage).not.toContain('withSubjectContext')
  })
})
