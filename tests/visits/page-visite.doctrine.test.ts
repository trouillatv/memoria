import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── UNE VISITE, UNE SEULE PORTE D'ENTRÉE (Vincent, 2026-07-22) ──────────────
//
// Il a existé deux pages pour une même visite : le « Débrief de chantier »,
// resté au monde d'avant le compte-rendu documentaire, et le récit. Vincent
// s'est lui-même trompé entre les deux — la meilleure preuve du défaut.
//
// Et la règle qui va avec : « une page ne doit proposer que les gestes cohérents
// avec son récit. » Sur une visite : écouter, comprendre, raconter, arbitrer,
// concrétiser. Créer une action ex nihilo n'appartient plus à cette histoire —
// non parce que c'était cassé, mais parce que ça rouvrait une DEUXIÈME porte
// vers un objet que la concrétisation fabrique déjà.

const dir = join(process.cwd(), 'app/(dashboard)/sites/[id]/visites/[visitId]')
const page = readFileSync(join(dir, 'page.tsx'), 'utf8')
/** Ce que la page PROPOSE, commentaires retirés : les en-têtes expliquent
 *  justement pourquoi certains gestes n'y sont plus, et ces phrases-là ne
 *  doivent pas faire échouer la règle qu'elles décrivent. */
const rendu = page.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')

describe('la page d’une visite EST le récit', () => {
  it('rend le lecteur du récit, pas un tableau de bord parallèle', () => {
    expect(page).toContain('<NarrativeReader')
    expect(page).toContain('buildVisitNarrative')
  })

  it('l’ancienne adresse du récit redirige au lieu de survivre en double', () => {
    const recit = readFileSync(join(dir, 'recit/page.tsx'), 'utf8')
    expect(recit).toMatch(/redirect\(`\/sites\/\$\{id\}\/visites\/\$\{visitId\}`\)/)
    expect(recit).not.toContain('NarrativeReader')
  })

  it('dit l’état du compte-rendu — la question qu’on se pose en arrivant', () => {
    expect(page).toContain('Aucun compte-rendu')
    expect(page).toContain('Compte-rendu en brouillon')
    expect(page).toMatch(/Compte-rendu finalisé/)
  })
})

describe('les gestes de la page sont ceux de son récit', () => {
  it('n’ouvre plus de seconde porte vers une action ou une réserve', () => {
    // Un objet créé ici n'apparaîtrait JAMAIS dans « ce que cette visite a
    // produit » : il naîtrait sans provenance.
    expect(rendu).not.toMatch(/Cr[ée]er une action/i)
    expect(rendu).not.toMatch(/Cr[ée]er une r[ée]serve/i)
    expect(rendu).not.toContain(`/sites/${'${id}'}/actions`)
    expect(rendu).not.toContain(`/sites/${'${id}'}/reserves`)
  })

  it('garde les gestes périphériques, mais dans le rail — pas dans le récit', () => {
    const rail = page.slice(page.indexOf('Actions sur cette visite'))
    for (const geste of ['Télécharger le compte-rendu', 'Ouvrir sur mobile', 'Retour au chantier']) {
      expect(rail).toContain(geste)
    }
  })

  it('on verse une PIÈCE, on n’ajoute pas une preuve', () => {
    // « Une preuve est une interprétation ; une pièce est simplement un élément
    // versé au dossier. » Le fait et son traitement restent deux gestes.
    expect(rendu).toContain('<VerserPiece')
    expect(rendu).not.toMatch(/Ajouter une preuve/i)
  })

  it('n’invente aucun historique d’analyse : il n’en existe pas', () => {
    // Une nouvelle analyse ECRASE l'ancienne. Afficher « v1 / v2 » raconterait
    // une histoire que la base ne sait pas démontrer (arbitrage 2026-07-22).
    expect(rendu).toContain('Dernière analyse')
    expect(rendu).not.toMatch(/v1|v2/)
  })
})

describe('le vieux débrief ne survit pas en pièces détachées', () => {
  it.each([
    ['VisitDebriefPanel.tsx', 'le panneau de débrief desktop'],
    ['CapturedKnowledgePanel.tsx', 'la saisie de connaissance à la main'],
    ['GenerateCrButton.tsx', 'le CR markdown, troisième concept de compte-rendu'],
  ])('%s a disparu — %s', (fichier) => {
    expect(existsSync(join(dir, fichier))).toBe(false)
  })

  it('le second agent IA du bureau est parti avec sa vue', () => {
    // `analyzeVisitDebriefAction` doublait `loadOrRunVisitDebrief` : deux
    // chemins vers la même lecture, dont un sans appelant. Le moteur, lui,
    // reste — c'est bien le doublon qui est retiré, pas la capacité.
    expect(existsSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/visites/actions.ts'))).toBe(false)
    expect(
      readFileSync(join(process.cwd(), 'lib/visits/debrief-analysis.ts'), 'utf8'),
    ).toContain('runVisitDebriefAgent')
  })
})

// ── VERSER UNE PIÈCE AU DOSSIER — lot A ────────────────────────────────────
//
// Le fait (une pièce entre au dossier) et son traitement (une analyse en tire
// des propositions) sont deux gestes distincts. Verser ne déclenche rien.

describe('verser une pièce ne déclenche aucune analyse', () => {
  const actions = readFileSync(join(dir, 'piece-actions.ts'), 'utf8')
  const geste = readFileSync(join(dir, 'VerserPiece.tsx'), 'utf8')

  it('le dépôt n’appelle jamais la lecture par le modèle', () => {
    for (const src of [actions, geste]) {
      expect(src).not.toContain('loadOrRunVisitDebrief')
      expect(src).not.toContain('getVisitDebriefFieldAction')
    }
  })

  it('le fichier part DIRECTEMENT au stockage — un Server Action le rejetterait', () => {
    expect(geste).toContain('uploadToSignedUrl')
    expect(actions).toContain('createSignedUploadUrl')
  })

  it('la date réelle est proposée, jamais devinée', () => {
    for (const reponse of ['Date du fichier', 'Date de la visite', 'Aujourd’hui', 'Autre']) {
      expect(geste).toContain(reponse)
    }
    expect(actions).toContain('captured_at')
  })

  it('le lot A s’arrête aux pièces que le dossier sait déjà traiter', () => {
    // Le document (PDF, mail) attend le lot B : il pose une question produit —
    // pièce jointe seulement, ou pièce analysable ?
    expect(actions).toMatch(/const KINDS = \['photo', 'vocal', 'video', 'note'\] as const/)
    expect(actions).not.toMatch(/'document'/)
  })

  it('l’isolation tenant est vérifiée dans le code, la RLS étant contournée', () => {
    expect(actions).toContain('visit.organization_id !== orgId')
  })
})
