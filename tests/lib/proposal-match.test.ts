import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  matchProposal, scoreCandidate, subjectOverlap,
  type MatchCandidate, type MatchSubject,
} from '@/lib/knowledge/proposal-match'

// ── LE CAS DE RÉFÉRENCE ──────────────────────────────────────────────────────
// Tiré de la vraie base, visite f8b83b3a du chantier de recette :
//   v1 → « Faire évacuer les gravats du local technique par Sotrap »  CONFIRMÉE
//   v2 → « Demander à Sotrap d'évacuer les gravats du local technique »  proposée
// Le conducteur a validé le fait ; la relecture le lui re-propose autrement dit.

const CONFIRMEE: MatchCandidate = {
  objectType: 'site_action',
  objectId: 'A-184',
  title: 'Faire évacuer les gravats du local technique par Sotrap',
  owner: 'Sotrap',
  due: 'fin de la semaine',
  sourceReportId: 'r1',
}

function sujet(title: string, patch: Partial<MatchSubject> = {}): MatchSubject {
  return { title, owner: 'Sotrap', due: 'avant la fin de semaine', sourceReportId: 'r1', ...patch }
}

describe('Le cas de référence — une reformulation ne crée pas un fait', () => {
  it('« Demander à Sotrap d’évacuer les gravats » se rattache à l’action existante', () => {
    const m = matchProposal(sujet("Demander à Sotrap d'évacuer les gravats du local technique"), [CONFIRMEE])
    // Le résultat attendu (Vincent) : « 1 site_action, 0 nouvelle proposition
    // visible, 1 lien de correspondance ». Donc `matched` — pas seulement « pas
    // nouveau ». Une fois les verbes d'injonction écartés, les deux phrases
    // portent EXACTEMENT les mêmes mots de contenu : même responsable, même
    // objet, même lieu. Il n'y a rien à demander à un humain.
    expect(m.status).toBe('matched')
    if (m.status === 'new') throw new Error('inatteignable')
    expect(m.objectId).toBe('A-184')
    // Le verdict s'EXPLIQUE : « pourquoi les avez-vous rapprochés ? »
    expect(m.reasons).toContain('same_subject')
    expect(m.reasons).toContain('same_owner')
  })

  it('« gravats de la COUR » n’est JAMAIS fusionné en silence', () => {
    // Le contre-exemple qui interdit la fusion sémantique naïve : les deux
    // phrases partagent presque tous leurs mots — évacuer, gravats, Sotrap —
    // sauf celui qui compte. Un embedding les rapprocherait ; ici l'écart de
    // vocabulaire (« cour » vs « local technique ») interdit le silence.
    const m = matchProposal(sujet('Faire évacuer les gravats de la cour par Sotrap'), [CONFIRMEE])
    expect(m.status, 'un lieu différent ne se fusionne jamais tout seul').not.toBe('matched')
    // Le verdict réel est `possible_duplicate` : l'humain tranche. Le seuil qui
    // sépare « assez proche pour demander » de « sans rapport » est un réglage,
    // et il se règle sur des données réelles — pas sur une intuition.
    expect(m.status).toBe('possible_duplicate')
  })

  it('le même fait redit MOT POUR MOT se rattache sans déranger personne', () => {
    const m = matchProposal(sujet(CONFIRMEE.title), [CONFIRMEE])
    expect(m.status).toBe('matched')
    if (m.status !== 'matched') throw new Error('inatteignable')
    expect(m.confidence).toBe(1)
  })

  it('un fait sans rapport reste NEUF', () => {
    const m = matchProposal(sujet("Informer le bureau d'études de la réservation de la gaine", { owner: "Bureau d'études" }), [CONFIRMEE])
    expect(m.status).toBe('new')
  })
})

// ── CE QUI FAIT LA DIFFÉRENCE ────────────────────────────────────────────────
describe('Les verbes d’injonction ne sont pas le fait', () => {
  it('« Faire évacuer » et « Demander d’évacuer » parlent de la même chose', () => {
    // C'est exactement là que la reformulation se joue : le modèle change le
    // verbe d'attaque, pas le fait.
    expect(subjectOverlap(
      'Faire évacuer les gravats du local technique par Sotrap',
      "Demander à Sotrap d'évacuer les gravats du local technique",
    )).toBe(1)
  })

  it('le lieu, lui, change tout', () => {
    const meme = subjectOverlap('évacuer les gravats du local technique', 'évacuer les gravats du local technique')
    const autre = subjectOverlap('évacuer les gravats du local technique', 'évacuer les gravats de la cour')
    expect(meme).toBe(1)
    expect(autre).toBeLessThan(meme)
  })
})

// ── LA CONTRAINTE, NON NÉGOCIABLE ────────────────────────────────────────────
// « Aucun rapprochement automatique ne peut modifier un objet confirmé par un
// humain. » (Vincent, 2026-07-17)
describe('Le moteur juge, il n’écrit jamais', () => {
  const src = readFileSync(join(process.cwd(), 'lib/knowledge/proposal-match.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('ne touche ni la base, ni le LLM, ni l’horloge', () => {
    expect(src, 'un verdict est une donnée, pas un effet').not.toMatch(/createAdminClient|\.from\(['"]|\.update\(|\.insert\(/)
    expect(src, 'le jugement doit être reproductible').not.toMatch(/Date\.now|new Date|Math\.random|fetch\(/)
  })

  it('ne peut produire que trois verdicts, et aucun ne réécrit', () => {
    for (const s of ["'new'", "'matched'", "'possible_duplicate'"]) expect(src).toContain(s)
    // 'update' / 'replace' seraient la porte par laquelle une formulation du
    // modèle viendrait écraser la parole d'un humain.
    expect(src).not.toMatch(/status: '(update|replace|rewrite)'/)
  })
})
