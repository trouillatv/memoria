// DOCTRINE DU SUJET (Vincent 2026-06-26) — à poser AVANT de remplir le graphe,
// sinon on fabrique des centaines de sujets inutiles.
//
//   Un sujet = un OBJET MÉTIER DURABLE (ouvrage / lot / livrable / point technique
//   récurrent). Exemples : « Porte coupe-feu », « Local TGBT », « Étanchéité
//   toiture », « DOE », « Réseau incendie ».
//   JAMAIS une personne (anti-RH). JAMAIS une action ponctuelle : « Relancer MOE »,
//   « Envoyer le DOE », « Faire le devis » sont des ACTIONS, pas des sujets.
//
// Module PUR (aucune dépendance serveur) → importable côté client (formulaire) ET
// serveur (find-or-create, garde-fous). La doctrine est exécutable, pas qu'un texte.

export const SUBJECT_DOCTRINE =
  'Un sujet décrit un objet métier durable (un ouvrage, un lot, un livrable), pas une action. « Porte coupe-feu » oui ; « Relancer MOE » non.'

/** Forme canonique pour comparer/dédupliquer : NFC, trim, espaces internes réduits. */
export function normalizeSubjectName(name: string | null | undefined): string {
  return (name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

/** Clé de déduplication (normalisée + insensible à la casse FR). */
export function subjectDedupKey(name: string | null | undefined): string {
  return normalizeSubjectName(name).toLocaleLowerCase('fr')
}

// Verbes d'action à l'infinitif en tête de libellé → décrit une TÂCHE, pas un objet.
const ACTION_VERBS = [
  'relancer', 'envoyer', 'faire', 'appeler', 'demander', 'vérifier', 'verifier',
  'transmettre', 'fournir', 'valider', 'contacter', 'prévoir', 'prevoir', 'planifier',
  'organiser', 'rappeler', 'corriger', 'réaliser', 'realiser', 'installer', 'poser',
  'commander', 'obtenir', 'récupérer', 'recuperer', 'préparer', 'preparer', 'rédiger',
  'rediger', 'signer', 'régler', 'regler', 'payer', 'établir', 'etablir', 'convoquer',
  'remettre', 'déposer', 'deposer', 'finaliser', 'compléter', 'completer', 'mettre',
]
const ACTION_RE = new RegExp(`^(?:${ACTION_VERBS.join('|')})\\b`, 'i')

/** Le libellé ressemble-t-il à une ACTION (verbe d'action en tête) plutôt qu'à un
 *  objet métier durable ? Heuristique déterministe, advisory (n'interdit pas). */
export function looksLikeAction(name: string | null | undefined): boolean {
  return ACTION_RE.test(normalizeSubjectName(name))
}
