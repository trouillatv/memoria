// P0-B/P0-C — détection générique de la date d'un document PV/CR.
// Prouve : (1) recette réelle 2024/2025 ; (2) cas synthétiques génériques ;
// (3) FORMAT-AGNOSTIQUE — aucune dépendance à une expression exacte, à la position,
// au numéro de page ni à un template CAPSE/Bella Napoli.

import { describe, it, expect } from 'vitest'
import { detectDocumentDate, detectNonVisitSignal } from '@/lib/documents/detect-document-date'

describe('detectDocumentDate — recette réelle Bella Napoli', () => {
  it('2024 : retient 19/07/2024 comme date de visite, pas une date interne', () => {
    const text = [
      'VISITE RESTAURANT BELLA NAPOLI DU 19 JUILLET 2024',
      'OBJET : Vérifications réglementaires',
      'DATE : 19/07/2024',
      "L'arrêté du 25 juin 1980 portant approbation…",
      'La délibération n°315 du 30 août 2013 relative…',
      'Installations électriques Fait le 22/03/2024 par Bureau Veritas',
      'Appareils de cuisson Fait le 25/03/2022 par Bureau Veritas',
    ].join('\n')
    const r = detectDocumentDate(text)
    expect(r.best?.iso).toBe('2024-07-19')
    expect(r.best?.semantics).toBe('visit_date')
    expect(r.ambiguous).toBe(false)
    // 25/06/1980 et 30/08/2013 ne doivent JAMAIS être retenues comme date de visite.
    expect(r.candidates.find((c) => c.iso === '1980-06-25')?.semantics).toBe('reference_date')
    expect(r.candidates.find((c) => c.iso === '2024-03-22')?.semantics).toBe('event_date')
  })

  it('2025 : distingue 05/08 (visite), 17/07 (contrôle MIES), 19/07/2024 (visite précédente)', () => {
    const text = [
      'Date de la visite précédente : 19/07/2024',
      'Extincteurs 17/07/25 MIES Registre de sécurité OK',
      "Système d'extinction automatique pour friteuse, 17/07/2025 MIES Registre de sécurité OK",
      'Nettoyage 14/11/2024 KFT',
      'CAPSE NC David BOUVIER & Catherine DELORME 05/08/2025',
      'Suivi RUS Dumbea - MALL - CAPSE NC - SACD - 2025.xlsx CR visite 050825 BELLA NAPOLI',
    ].join('\n')
    const r = detectDocumentDate(text)
    expect(r.best?.iso).toBe('2025-08-05')
    expect(r.best?.semantics).toBe('visit_date')
    expect(r.ambiguous).toBe(false)
    expect(r.candidates.find((c) => c.iso === '2024-07-19')?.semantics).toBe('previous_visit_date')
    // 17/07/2025 est un ÉVÉNEMENT (contrôle MIES), jamais la date de visite.
    const j1707 = r.candidates.filter((c) => c.iso === '2025-07-17')
    expect(j1707.length).toBeGreaterThan(0)
    expect(j1707.every((c) => c.semantics === 'event_date')).toBe(true)
  })
})

describe('detectDocumentDate — cas synthétiques génériques', () => {
  it('une seule date évidente', () => {
    const r = detectDocumentDate('Compte-rendu du 03/04/2026 sur le chantier.')
    expect(r.best?.iso).toBe('2026-04-03')
    expect(r.ambiguous).toBe(false)
  })

  it('plusieurs dates dont une date de visite', () => {
    const r = detectDocumentDate('Visite du 10/03/2026. Contrôle réalisé le 02/01/2026 par ACME. Échéance avant 30/06/2026.')
    expect(r.best?.iso).toBe('2026-03-10')
    expect(r.candidates.find((c) => c.iso === '2026-01-02')?.semantics).toBe('event_date')
    expect(r.candidates.find((c) => c.iso === '2026-06-30')?.semantics).toBe('deadline_date')
  })

  it('date de visite absente (uniquement des événements) → best null, jamais un événement promu', () => {
    const r = detectDocumentDate('Contrôle réalisé le 02/01/2026 par ACME. Fait le 05/05/2025 par BETA.')
    expect(r.best).toBeNull()
    expect(r.candidates.every((c) => c.semantics === 'event_date')).toBe(true)
  })

  it('deux dates de visite plausibles et distinctes → ambiguous, ne tranche pas artificiellement', () => {
    const r = detectDocumentDate('Visite du 01/02/2026. Réunion du 05/02/2026.')
    expect(r.ambiguous).toBe(true)
    expect(new Set(r.candidates.filter((c) => ['visit_date', 'meeting_date'].includes(c.semantics)).map((c) => c.iso)).size).toBeGreaterThan(1)
  })

  it('aucune date exploitable → best null, candidats vides, workflow inchangé', () => {
    const r = detectDocumentDate('Aucune date ici, seulement du texte réglementaire générique.')
    expect(r.best).toBeNull()
    expect(r.candidates).toHaveLength(0)
    expect(r.ambiguous).toBe(false)
  })

  it('texte vide → détection vide', () => {
    expect(detectDocumentDate('').best).toBeNull()
    expect(detectDocumentDate('   ').candidates).toHaveLength(0)
  })
})

describe('detectDocumentDate — FORMAT-AGNOSTIQUE (aucune exception codée pour ce corpus)', () => {
  it('la même date de visite est trouvée via plusieurs tournures différentes', () => {
    const iso = '2026-04-03'
    for (const phrase of [
      'Visite du 03/04/2026',
      'CR visite 030426',
      'Compte-rendu du 03/04/2026',
      'Date de la visite : 03/04/2026',
      'RÉUNION DU 3 avril 2026',
    ]) {
      const r = detectDocumentDate(phrase)
      expect(r.best?.iso, phrase).toBe(iso)
      expect(['visit_date', 'meeting_date', 'report_date']).toContain(r.best?.semantics)
    }
  })

  it('indépendant de la POSITION : date de visite en début, milieu ou fin', () => {
    const visit = 'Visite du 12/09/2026'
    const noise = 'Contrôle réalisé le 01/01/2026 par ACME. Texte. Échéance avant 31/12/2026.'
    for (const text of [`${visit}. ${noise}`, `${noise} ${visit}. Autre texte.`, `Début. ${noise} ${visit}`]) {
      expect(detectDocumentDate(text).best?.iso).toBe('2026-09-12')
    }
  })

  it('une date adjacente à un organisme est un événement, quel que soit le nom (générique)', () => {
    for (const org of ['MIES', 'KFT', 'ACME', 'Bureau Veritas']) {
      const r = detectDocumentDate(`Extincteurs 07/07/2026 ${org} Registre OK`)
      expect(r.candidates.find((c) => c.iso === '2026-07-07')?.semantics, org).toBe('event_date')
    }
  })

  it('ne dépend pas du numéro de page ni des marqueurs [[page N]] pour trouver la visite', () => {
    const withPages = '[[page 1]] En-tête.\nVisite du 08/08/2026.\n[[page 2]] Suite.'
    const withoutPages = 'En-tête. Visite du 08/08/2026. Suite.'
    expect(detectDocumentDate(withPages).best?.iso).toBe('2026-08-08')
    expect(detectDocumentDate(withoutPages).best?.iso).toBe('2026-08-08')
    // La preuve de page est un bonus quand elle existe, jamais une condition.
    expect(detectDocumentDate(withPages).best?.page).toBe(1)
    expect(detectDocumentDate(withoutPages).best?.page).toBeNull()
  })
})

// Finding #10 (chantier fermeture extraction historique) : « 27 et 31/03/2025 » ne doit pas
// être réduit à la seule date complète (31/03) classée seule comme confirmée — les deux jours
// désignent des visites distinctes partageant le même mois/année.
describe('detectDocumentDate — énumération compacte « JJ et JJ/MM/AAAA » (finding #10)', () => {
  it('« visite du 27 et 31/03/2025 » produit deux candidats distincts, tous deux visit_date', () => {
    const r = detectDocumentDate('Visite du 27 et 31/03/2025 sur le chantier.')
    const iso27 = r.candidates.find((c) => c.iso === '2025-03-27')
    const iso31 = r.candidates.find((c) => c.iso === '2025-03-31')
    expect(iso27).toBeDefined()
    expect(iso31).toBeDefined()
    expect(r.ambiguous).toBe(true)
  })

  it('supporte la virgule comme séparateur : « 27, 31/03/2025 »', () => {
    const r = detectDocumentDate('Visite du 27, 31/03/2025.')
    expect(r.candidates.some((c) => c.iso === '2025-03-27')).toBe(true)
    expect(r.candidates.some((c) => c.iso === '2025-03-31')).toBe(true)
  })

  it('ne casse pas la détection d\'une date isolée classique', () => {
    const r = detectDocumentDate('Visite du 31/03/2025.')
    expect(r.best?.iso).toBe('2025-03-31')
    expect(r.ambiguous).toBe(false)
  })
})

// Finding #1 (chantier fermeture extraction historique) : un document daté ne prouve pas une
// visite terrain — signal générique, STRICTEMENT séparé de detectDocumentDate, jamais un
// blocage silencieux (l'humain confirme, cf. review-actions.ts createHistoricalVisitAction).
describe('detectNonVisitSignal — finding #1', () => {
  it('détecte « pas de visite de site » et fournit une preuve textuelle', () => {
    const r = detectNonVisitSignal("Point de suivi en bureau, pas de visite de site ce jour.")
    expect(r.detected).toBe(true)
    expect(r.evidence).toContain('visite')
  })

  it('détecte les variantes « aucune visite » et « sans visite »', () => {
    expect(detectNonVisitSignal('Aucune visite terrain effectuée.').detected).toBe(true)
    expect(detectNonVisitSignal('Réunion tenue sans visite de chantier.').detected).toBe(true)
  })

  it('ne détecte rien sur un CR de visite terrain classique', () => {
    const r = detectNonVisitSignal('Visite du 03/04/2026. Contrôle des installations électriques.')
    expect(r.detected).toBe(false)
    expect(r.evidence).toBeNull()
  })

  it('texte vide → aucun signal', () => {
    expect(detectNonVisitSignal('').detected).toBe(false)
    expect(detectNonVisitSignal('   ').detected).toBe(false)
  })

  it('remonte le numéro de page du signal quand des marqueurs existent', () => {
    const r = detectNonVisitSignal('[[page 1]] En-tête.\n[[page 2]] Pas de visite de site aujourd\'hui.')
    expect(r.detected).toBe(true)
    expect(r.page).toBe(2)
  })
})
