// Lot F3-1 — ÉLIGIBILITÉ d'une proposition `person` historique à devenir un
// PARTICIPANT structuré d'un rapport (site_reports.participants).
//
// RÈGLE FONDATRICE : une personne détectée n'est PAS un participant par défaut.
// Elle ne le devient que si elle porte une PREUVE explicite de lien à CET
// événement (présence / absence / invitation / diffusion). Sont insuffisants
// SEULS : interlocuteur, rôle (RUS/MOE/AMO/titulaire…), contact, appartenance
// entreprise, simple mention. Sous F1, tous ces cas sont déjà normalisés en
// « inconnu » → cette fonction retourne alors `null`.
//
// PÉRIMÈTRE : fonction PURE, sans DB, sans écriture. Elle décide « est-ce un
// participant ? » (F3-1). Elle NE crée PAS de contact et NE projette RIEN dans
// site_reports.participants (F3-2), ne backfille rien (F3-3).
//
// SOURCE DE VÉRITÉ : le verdict de présence NORMALISÉ F1 (statusAtDocumentDate).
// On ne re-dérive JAMAIS la présence depuis le rôle : c'est le travail de F1.
// Ne jamais traiter un statusAtDocumentDate PRÉ-F1 comme vérité de présence.

import type { ParticipantPresence } from '@/types/db'

/** Entrée = la partie sémantique d'une proposition `person`. */
export interface HistoricalPersonInput {
  /** libellé « Prénom NOM ». */
  label: string
  /** description « Fonction — Entreprise » : rôle/appartenance CONSERVÉS mais
   *  qui ne DÉCIDENT jamais de la participation. */
  description?: string | null
  /** verdict de présence normalisé F1 = sourcePayload.statusAtDocumentDate. */
  presenceVerdict?: string | null
}

/** Sortie = la SÉMANTIQUE de participation, prête pour la projection F3-2.
 *  Ne contient ni contactId ni écriture : juste ce qu'un participant serait. */
export interface HistoricalParticipantProjection {
  name: string
  role: string | null
  kind: 'person'
  /** P/AE/AN, ou absent (undefined) quand la présence n'est pas renseignée. */
  presence?: ParticipantPresence
  invite: boolean
  diffusion: boolean
  /** justification déterministe (tests/audit). */
  reason: string
}

/** Rôle « court » = 1er segment de la description (« Fonction — Entreprise »). */
function roleFromDescription(description?: string | null): string | null {
  const first = (description ?? '').split('—')[0]?.trim()
  return first || null
}

/**
 * Décide si une proposition `person` est un participant de l'événement, et avec
 * quelle sémantique. Retourne `null` si la personne n'a AUCUNE preuve de lien
 * participatif (le cas majoritaire : interlocuteur/rôle/mention → « inconnu »).
 */
export function eligibleHistoricalPersonParticipant(
  input: HistoricalPersonInput,
): HistoricalParticipantProjection | null {
  const name = input.label.trim()
  if (!name) return null
  const role = roleFromDescription(input.description)
  const base = { name, role, kind: 'person' as const }
  const v = (input.presenceVerdict ?? '').trim().toLowerCase()

  // Preuve de PRÉSENCE / ABSENCE → participant avec statut P/AE/AN.
  if (/^pr[ée]sent/.test(v)) {
    return { ...base, presence: 'P', invite: false, diffusion: false, reason: 'présence prouvée' }
  }
  if (/^absent\s*excus/.test(v)) {
    return { ...base, presence: 'AE', invite: false, diffusion: false, reason: 'absence excusée prouvée' }
  }
  if (/^absent\s*non\s*excus/.test(v)) {
    return { ...base, presence: 'AN', invite: false, diffusion: false, reason: 'absence non excusée prouvée' }
  }
  // INVITÉ → participant SANS présence renseignée (invité ≠ présent).
  if (/^invit|^convoqu/.test(v)) {
    return { ...base, invite: true, diffusion: false, reason: 'invité (présence non prouvée)' }
  }
  // DIFFUSION / DESTINATAIRE → participant SANS présence renseignée.
  if (/^diffusion|^destinataire/.test(v)) {
    return { ...base, invite: false, diffusion: true, reason: 'diffusion / destinataire (présence non prouvée)' }
  }

  // « inconnu », « non déterminé », vide, ou tout autre (interlocuteur/rôle/
  // mention déjà normalisés en inconnu par F1) → PAS de participant.
  return null
}
