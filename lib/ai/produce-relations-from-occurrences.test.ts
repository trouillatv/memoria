// Tests de régression — selectBestNote (P0-B1)
//
// Ces trois cas correspondent exactement aux anomalies observées sur le dry-run PETRO
// et doivent rester verts pour garantir la qualité des evidences transmises à Gemini.

import { describe, it, expect } from 'vitest'
import { selectBestNote } from './produce-relations-from-occurrences'
import type { OccurrenceData } from './produce-relations-from-occurrences'

function occ(label: string, note: string | null = null): OccurrenceData {
  return { occurrenceId: 'test-id', label, note, effectiveDate: '2026-01-01', proposalId: null }
}

describe('selectBestNote', () => {
  // Régression [1] — candidat PETRO [1]A : le label d'occurrence est plus riche que le canonical.
  // Avant le fix : fallback direct sur canonical "Nettoyage panneaux isothermes (chambres froides)".
  it('uses occurrence label over canonical fallback when note is absent', () => {
    const occs = [
      occ('Le nettoyage du carrelage ne sera pas inclus dans la prestation et sera remplacé par un nettoyage complet des panneaux isothermes.'),
      occ('Démarrage du nettoyage des panneaux isothermes'),
    ]
    const result = selectBestNote(occs, 'Nettoyage panneaux isothermes (chambres froides)')
    expect(result.source).toBe('occurrence_note')
    expect(result.text).not.toBe('Nettoyage panneaux isothermes (chambres froides)')
    expect(result.text.length).toBeGreaterThan(30)
  })

  // Régression [2] — candidat PETRO [10/12]B : "La semaine prochaine" ne doit pas l'emporter
  // sur "Verification installations electriques" simplement parce qu'elle vient d'un champ note.
  // Avant le fix : "La semaine prochaine" était retourné (première note non-nulle trouvée).
  it('prefers informative occurrence label over purely temporal note', () => {
    const occs = [
      occ('Verification installations electriques', 'La semaine prochaine'),
    ]
    const result = selectBestNote(occs, 'Vérification des lignes électriques et consignations')
    expect(result.source).toBe('occurrence_note')
    expect(result.text).toContain('Verification installations electriques')
    expect(result.text).not.toContain('La semaine prochaine')
  })

  // Régression [3] — fallback canonical uniquement si note ET label sont tous deux non informatifs.
  // Avant le fix : tout texte dans o.note déclenchait occurrence_note même si purement temporel.
  it('falls back to canonical label only when all occurrence texts are non-informative', () => {
    const occs = [
      occ('Demain', 'La semaine prochaine'),
      occ('Ce vendredi', 'Prochainement'),
    ]
    const result = selectBestNote(occs, 'Sujet canonique de référence')
    expect(result.source).toBe('subject_label_fallback')
    expect(result.text).toBe('Sujet canonique de référence')
  })

  // Complémentaire — texte long débutant par un marqueur temporel : il porte du contenu métier
  // et ne doit PAS être rejeté (règle MAX_TEMPORAL_CHARS = 50).
  it('keeps long text starting with temporal marker when it carries business content', () => {
    const occs = [
      occ('Vérification des lignes électriques prévue la semaine prochaine selon le plan de sécurité'),
    ]
    const result = selectBestNote(occs, 'canonical')
    expect(result.source).toBe('occurrence_note')
    expect(result.text).toContain('Vérification')
  })
})
