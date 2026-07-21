import { describe, expect, it } from 'vitest'
import {
  comparerNoms,
  distance,
  normaliserNom,
  POIDS_IDENTITE,
  rapprocher,
  type ActeurConnu,
} from '@/lib/acteurs/resolution-identite'
import { qualifier, SEUILS_CONFIANCE } from '@/lib/confiance/suggestion'

// ── LA MÉMOIRE SE FRAGMENTE À LA SAISIE (Vincent, 2026-07-22) ──────────────
//
// « Yann », « Y. Martin » et « Yann Martin » créent trois contacts, parce que
// `findOrCreateCompanyContact` ne rapproche que par égalité exacte. Chaque
// visite ajoute une variante — d'autant plus vite que le produit sert.
//
// Ce module ne FUSIONNE rien : fusionner après coup est destructif. Il sert à
// ce que la deuxième variante n'existe jamais, en proposant la première au
// moment de la saisie. Ces tests protègent donc deux choses à parts égales :
// ce qu'il reconnaît, et ce qu'il refuse de reconnaître.

describe('normaliserNom — accents, casse et ponctuation ne séparent personne', () => {
  it('ramène les variantes d’écriture au même texte', () => {
    expect(normaliserNom('Y. MARTIN')).toBe('y martin')
    expect(normaliserNom('  Jérôme  ')).toBe('jerome')
    expect(normaliserNom('Clim-Expert')).toBe('clim expert')
  })

  it('ne casse pas sur le vide', () => {
    expect(normaliserNom('')).toBe('')
    expect(normaliserNom('   ')).toBe('')
  })
})

describe('distance — on cherche une faute de frappe, pas une ressemblance', () => {
  it('compte les lettres qui changent', () => {
    expect(distance('martin', 'martin')).toBe(0)
    expect(distance('martin', 'martn')).toBe(1)
    expect(distance('martin', 'marten')).toBe(1)
  })

  it('abandonne au-delà de la borne plutôt que de mesurer pour rien', () => {
    // Au-delà, la question « est-ce une faute de frappe » ne se pose plus.
    expect(distance('martin', 'dupont', 2)).toBeGreaterThan(2)
  })
})

describe('comparerNoms — ce qu’il reconnaît', () => {
  it('le même nom, écrit autrement', () => {
    expect(comparerNoms('Yann Martin', 'yann martin')).toEqual({ regle: 'identique', score: 100 })
    expect(comparerNoms('Jérôme', 'jerome')).toEqual({ regle: 'identique', score: 100 })
  })

  it('l’initiale et le nom de famille — le cas « Y. Martin »', () => {
    const r = comparerNoms('Yann Martin', 'Y. Martin')
    expect(r?.regle).toBe('initiale-et-nom')
    expect(r?.score).toBe(90)
  })

  it('le prénom seul — mais avec la prudence qu’il mérite', () => {
    const r = comparerNoms('Yann', 'Yann Martin')
    expect(r?.regle).toBe('prenom-seul')
    // 70, pas 95 : il peut y avoir deux Yann sur un chantier. Assez pour
    // PROPOSER, jamais pour décider — et rien ici n'écrit.
    expect(r?.score).toBe(70)
  })

  it('une faute de frappe sur un nom assez long', () => {
    const r = comparerNoms('Jerome Dupont', 'Jerome Dupnt')
    expect(r?.regle).toBe('orthographe-proche')
  })
})

describe('comparerNoms — ce qu’il REFUSE de reconnaître', () => {
  it('deux noms différents', () => {
    expect(comparerNoms('Yann Martin', 'Jérôme Dupont')).toBeNull()
  })

  it('deux prénoms courts à une lettre près — « Luc » n’est pas « Duc »', () => {
    // Sur un nom court, une lettre change la personne. La règle de faute de
    // frappe exige donc une longueur minimale.
    expect(comparerNoms('Luc', 'Duc')).toBeNull()
  })

  it('même prénom mais noms de famille différents', () => {
    // « Yann Martin » et « Yann Dupont » sont deux personnes. Les rapprocher
    // fusionnerait deux histoires distinctes.
    expect(comparerNoms('Yann Martin', 'Yann Dupont')).toBeNull()
  })

  it('le vide ne ressemble à rien', () => {
    expect(comparerNoms('', 'Yann')).toBeNull()
    expect(comparerNoms('Yann', '   ')).toBeNull()
  })
})

describe('rapprocher — proposer, dans l’ordre, avec le motif', () => {
  const connus: ActeurConnu[] = [
    { id: '1', nom: 'Yann Martin', entreprise: 'AGP' },
    { id: '2', nom: 'Jérôme Dupont', entreprise: 'Clim Expert' },
    { id: '3', nom: 'Yann Bernard', entreprise: 'Clim Expert' },
  ]

  it('retrouve la personne derrière une initiale', () => {
    const r = rapprocher('Y. Martin', connus)
    expect(r).toHaveLength(1)
    expect(r[0]!.candidat.id).toBe('1')
    expect(r[0]!.motif).toBe('même nom de famille, prénom en initiale')
  })

  it('propose les DEUX Yann sur un prénom seul — sans en choisir un', () => {
    // C'est exactement le cas où trancher serait une faute : deux personnes
    // portent ce prénom, et le texte ne dit pas laquelle.
    const r = rapprocher('Yann', connus)
    expect(r.map((x) => x.candidat.id).sort()).toEqual(['1', '3'])
  })

  it('l’entreprise fait pencher, elle ne tranche pas', () => {
    const r = rapprocher('Yann', connus, { entreprise: 'AGP' })
    // Yann Martin (AGP) passe devant Yann Bernard…
    expect(r[0]!.candidat.id).toBe('1')
    expect(r[0]!.motif).toContain('même entreprise')
    // …mais l'autre reste proposé : le bonus ordonne, il n'élimine pas.
    expect(r).toHaveLength(2)
  })

  it('ne rend rien plutôt que du bruit', () => {
    expect(rapprocher('Sotrap', connus)).toEqual([])
    expect(rapprocher('', connus)).toEqual([])
  })

  it('le seuil se règle, et le défaut ne laisse pas passer le hasard', () => {
    // Au-dessus de 70, le prénom seul disparaît : on ne garde que les
    // rapprochements sûrs.
    expect(rapprocher('Yann', connus, { minimum: 80 })).toEqual([])
  })

  it('à score égal, l’ordre ne bouge pas d’une visite à l’autre', () => {
    const a = rapprocher('Yann', connus).map((x) => x.candidat.id)
    const b = rapprocher('Yann', connus).map((x) => x.candidat.id)
    expect(a).toEqual(b)
  })
})

// ── LA POLITIQUE EST UNE DÉCISION PRODUIT, PAS UN DÉTAIL DE RENDU ──────────
//
// Le seuil de pré-remplissage a d'abord vécu dans un composant, écrit
// `score >= 90` au milieu du JSX. « À partir de quand MemorIA remplit-il à la
// place de l'humain ? » était donc invisible, non testable, et impossible à
// ajuster sans relire du rendu. Ces tests protègent son nouvel emplacement.

describe('chaque suggestion dit ce qu’on a le droit d’en faire', () => {
  const connus: ActeurConnu[] = [
    { id: '1', nom: 'Yann Martin', entreprise: 'AGP' },
    { id: '2', nom: 'Yann Bernard', entreprise: 'Clim Expert' },
  ]

  it('un rapprochement sûr autorise le pré-remplissage', () => {
    const [r] = rapprocher('Y. Martin', connus)
    expect(r!.action).toBe('pre-remplir')
    expect(r!.confiance).toBe('forte')
  })

  it('le prénom seul PROPOSE, il ne remplit pas', () => {
    // Deux Yann existent ici : pré-remplir ferait valider une association que
    // personne n'a vérifiée.
    const r = rapprocher('Yann', connus)
    expect(r.every((x) => x.action === 'demander')).toBe(true)
  })

  it('chaque suggestion porte le moteur qui l’a produite', () => {
    const [r] = rapprocher('Y. Martin', connus)
    expect(r!.origine).toBe('acteurs/identite')
  })

  it('les seuils et les poids sont nommés, jamais écrits en dur', () => {
    // Le jour où « le prénom seul est trop permissif », on change un nombre —
    // sans toucher à un seul algorithme.
    expect(SEUILS_CONFIANCE.preRemplir).toBeGreaterThan(SEUILS_CONFIANCE.proposer)
    expect(POIDS_IDENTITE['prenom-seul']).toBeLessThan(POIDS_IDENTITE['initiale-et-nom'])
    // Et le poids du prénom seul reste SOUS le seuil de pré-remplissage :
    // c'est ce qui garantit qu'il ne remplira jamais tout seul.
    expect(POIDS_IDENTITE['prenom-seul']).toBeLessThan(SEUILS_CONFIANCE.preRemplir)
  })

  it('qualifier ne laisse passer aucun score sous le bruit de fond', () => {
    expect(qualifier(95).action).toBe('pre-remplir')
    expect(qualifier(75).action).toBe('demander')
    expect(qualifier(40).action).toBe('ignorer')
  })
})
