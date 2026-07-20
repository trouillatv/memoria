import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Fiche Observation — quatrième et dernier objet du Lot 4 ──────────────────
// C'était le test du gabarit : l'objet qui vivait le plus « dans le chantier ».
// Ce fichier protège la réponse à la seule vraie question qu'il posait — quelle
// est sa relation principale — parce que c'est elle qui décide du fil et du chapô.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const model = read('lib/knowledge/observation-fiche.ts')
const body = read('app/(dashboard)/sites/[id]/views/observation/ObservationFiche.tsx')

describe('getSiteObservationFiche — factuel et fail-closed', () => {
  it('garde org fail-closed + scope chantier', () => {
    expect(model).toContain('getOrgId')
    expect(model).toMatch(/site\.organization_id !== orgId/)
    expect(model).toMatch(/from\('visit_capture'\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('UNE seule vague pour les lectures indépendantes', () => {
    expect(model).toMatch(/Promise\.all\(\[\s*\n\s*getOrgId\(\)/)
  })

  it('la visite est relue SCOPÉE au chantier, malgré le lien direct', () => {
    expect(model).toMatch(/from\('site_reports'\)[\s\S]*?eq\('site_id', siteId\)/)
  })
})

describe('La relation principale : la VISITE dans le fil, le PRODUIT dans le chapô', () => {
  it('la visite est un maillon du fil — elle est garantie par le modèle', () => {
    // `report_id` est NOT NULL : une observation appartient toujours à une visite.
    expect(body).toMatch(/\{ typeLabel: 'Visite', href: o\.visite\.href, current: false \}/)
  })

  it('le chapô ne répète PAS la visite — il porte ce qu’elle a produit', () => {
    // Règle 4 : une information n'est expliquée qu'une seule fois. Le fil dit
    // qu'il y a une visite en amont ; le chapô dirait la même chose.
    expect(body).not.toMatch(/label: '(Relevée|Constatée) (lors|pendant)/)
    expect(body).toMatch(/label: 'A produit', title: seul\.typeLabel/)
    expect(body).toContain("label: 'A produit plusieurs objets', title: null")
  })

  it('aucun produit → pas de chapô, et le corps dit POURQUOI', () => {
    expect(body).toMatch(/const chapo: Chapo \| null =[\s\S]*?:\s*null\n/)
    expect(body).toContain('Pas encore versée vers un objet du chantier.')
  })
})

describe('Ce que la fiche ne prétend pas savoir', () => {
  it('seuls les routages MATÉRIELS sont lus — une projection n’a aucune cible', () => {
    // `journal` et `compte_rendu` ont target_id NULL par construction : y chercher
    // un objet à ouvrir produirait un lien vers nulle part.
    expect(model).toMatch(/from\('visit_capture_routes'\)[\s\S]*?not\('target_id', 'is', null\)/)
  })

  it('une cible sans fiche n’obtient pas d’adresse fabriquée', () => {
    expect(model).toMatch(/typeLabel: 'Anomalie', href: null/)
  })

  it('sans texte, le titre nomme le GESTE — il n’en invente pas un', () => {
    expect(body).toMatch(/const titre = o\.texte \?\? `\$\{o\.genreLabel\}/)
  })

  it('une transcription en cours est DITE, pas confondue avec un vide', () => {
    expect(model).toContain("transcriptionEnCours: c.transcript_status === 'pending'")
    expect(body).toContain('Transcription du vocal en cours.')
  })

  it('la pièce jointe est annoncée, jamais affichée ici', () => {
    expect(model).toContain('pieceJointe: Boolean(c.attachment_id)')
    expect(model).not.toMatch(/storage_path/)
  })
})

describe('Vocabulaire de conducteur, pas de développeur', () => {
  it('aucun statut technique ne fuit à l’écran', () => {
    for (const mot of ['captured', 'kept', 'discarded', 'processed']) {
      // Ils existent comme CLÉS de correspondance, jamais comme libellés.
      expect(model).toMatch(new RegExp(`${mot}:\\s*'[^']`))
    }
    expect(model).toContain("captured: 'Relevée sur le terrain — pas encore triée'")
    expect(model).not.toMatch(/'routée'|«\s*routage\s*»/)
  })
})
