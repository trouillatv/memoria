// Une proposition « stakeholder » est une chaîne nue lue dans un mémo :
// « Vincent Milon (PAVE) », « Ginger », « M. Dupont ». Ce helper PROPOSE une
// lecture personne/entreprise pour préremplir le formulaire de confirmation —
// il ne DÉCIDE jamais : l'humain tranche (doctrine « mémoire assistée »).
// Pur et sans dépendance : utilisable côté client comme côté serveur.

export interface PersonCompanySplit {
  person: string | null
  company: string | null
}

/** « Vincent Milon (PAVE) » → { person: 'Vincent Milon', company: 'PAVE' }.
 *  Sans parenthèses, on ne devine pas : les deux champs restent nuls et le
 *  formulaire préremplit avec le titre brut. */
export function splitPersonCompany(title: string): PersonCompanySplit {
  const m = title.trim().match(/^(.+?)\s*\(([^()]+)\)$/)
  if (!m) return { person: null, company: null }
  const person = m[1].trim()
  const company = m[2].trim()
  if (!person || !company) return { person: null, company: null }
  return { person, company }
}

/** Un titre qui RESSEMBLE à une personne (« Prénom Nom », « M. Dupont ») — un
 *  simple indice d'affichage pour présélectionner l'onglet Personne, jamais une
 *  décision d'écriture. */
export function looksLikePerson(title: string): boolean {
  const t = title.trim()
  if (/^(m\.|mr|mme|monsieur|madame)\s/i.test(t)) return true
  // Deux mots capitalisés sans forme juridique (SARL, SAS, EURL, BET…).
  if (/\b(sarl|sas|sasu|eurl|sci|bet|bureau|entreprise|sté|société)\b/i.test(t)) return false
  return /^[A-ZÀ-Ż][\p{L}'-]+\s+[A-ZÀ-Ż][\p{L}'-]+$/u.test(t)
}
