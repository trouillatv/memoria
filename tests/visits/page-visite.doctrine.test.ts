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
    expect(page).toContain('<VisitDesk')
    expect(page).toContain('buildVisitNarrative')
  })

  it('l’ancienne adresse du récit redirige au lieu de survivre en double', () => {
    const recit = readFileSync(join(dir, 'recit/page.tsx'), 'utf8')
    expect(recit).toMatch(/redirect\(`\/sites\/\$\{id\}\/visites\/\$\{visitId\}`\)/)
    expect(recit).not.toContain('VisitDesk')
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
    const rail = page.slice(page.indexOf("Actions sur cette visite"))
    for (const geste of ['Télécharger le compte-rendu', 'Ouvrir sur mobile', 'Retour au chantier']) {
      expect(page).toContain(geste)
    }
    expect(rail).toContain('Télécharger le compte-rendu')
  })

  it('on verse une PIÈCE, on n’ajoute pas une preuve', () => {
    // « Une preuve est une interprétation ; une pièce est simplement un élément
    // versé au dossier. » Le fait et son traitement restent deux gestes.
    expect(rendu).toContain('<VerserPiece')
    expect(rendu).not.toMatch(/Ajouter une preuve/i)
  })

  it('dit si l’analyse est à jour ou dépassée — l’absence laissait le doute', () => {
    expect(rendu).toContain('Analyse MemorIA à jour')
    expect(rendu).toContain('Analyse MemorIA dépassée')
  })

  it('n’invente aucun historique d’analyse : il n’en existe pas', () => {
    // Une nouvelle analyse ECRASE l'ancienne. Afficher « v1 / v2 » raconterait
    // une histoire que la base ne sait pas démontrer (arbitrage 2026-07-22).
    expect(rendu).toContain('Dernière analyse le')
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

// ── LE FUSEAU DE L'ORGANISATION, PARTOUT (Vincent, 2026-07-22) ─────────────
//
// Le rendu serveur tourne en UTC. Sans `timeZone`, une capture de 09:15 à
// Nouméa s'affichait 22:15 la veille — une frise fausse d'un jour, sur l'écran
// qui prétend justement dire quand les choses se sont passées.

describe('toutes les heures d’une visite sont celles du chantier', () => {
  const surfaces = [
    ['app/(dashboard)/sites/[id]/visites/[visitId]/page.tsx', 'la page de la visite'],
    ['app/(dashboard)/sites/[id]/visites/[visitId]/VisitDesk.tsx', 'le bureau de traitement'],
    ['app/(dashboard)/sites/[id]/visites/page.tsx', 'la liste des visites'],
    ['app/(field)/m/visite/[reportId]/recap/page.tsx', 'la récap mobile'],
    ['app/(field)/m/visite/[reportId]/cr/MemoriaRetained.tsx', 'la synthèse mobile'],
    // Deuxième passe (Vincent, 2026-07-22) : la visite du 21/07 à 10 h s'affichait
    // « 20 juillet » sur la fiche chantier ET dans le compte-rendu exporté.
    ['app/(dashboard)/sites/[id]/SiteVisitsList.tsx', 'la liste des visites du chantier'],
    ['app/(field)/m/reunion/[reportId]/page.tsx', 'la récap de réunion'],
    ['app/(dashboard)/sites/[id]/visites/[visitId]/compte-rendu/page.tsx', 'le compte-rendu au bureau'],
    ['app/(dashboard)/sites/[id]/visites/[visitId]/compte-rendu/atelier/page.tsx', 'l’atelier du compte-rendu'],
    // Le producteur, pas seulement les écrans : `dateLabel` d'ici part dans le
    // PDF et l'export markdown, où une date fausse devient un document faux.
    ['lib/db/visits.ts', 'les libellés de date du moteur de visite'],
  ] as const

  it.each(surfaces)('%s — %s ne formate aucune date en UTC', (fichier) => {
    const src = readFileSync(join(process.cwd(), fichier), 'utf8')
    const formatages = src.match(/toLocale(?:Date|Time)?String\([\s\S]{0,220}?\)/g) ?? []
    for (const f of formatages) {
      // Une date affichée sans fuseau prend celui du serveur, donc UTC.
      expect(f, `${fichier} : ${f.slice(0, 60)}…`).toMatch(/timeZone/)
    }
  })
})

// ── LE BUREAU NE RENVOIE PAS AU TÉLÉPHONE ──────────────────────────────────
//
// Le compte-rendu, la concrétisation et l'arbitrage n'existaient qu'à l'adresse
// mobile : depuis le poste de travail, « Arbitrer » éjectait le conducteur dans
// la coquille téléphone pour faire le travail de la visite. Un seul moteur,
// deux surfaces — comme partout ailleurs ici.

describe('la visite desktop reste dans le bureau', () => {
  it('ne renvoie vers /m que là où c’est le geste demandé', () => {
    const liens = [...rendu.matchAll(/href=\{`(\/m\/[^`]+)`\}/g)].map((m) => m[1]!)
    for (const lien of liens) {
      expect(lien, `lien mobile inattendu : ${lien}`).toContain('/recap')
    }
  })

  it('le compte-rendu a sa propre adresse de bureau', () => {
    expect(rendu).toContain('/compte-rendu')
    expect(existsSync(join(dir, 'compte-rendu/page.tsx'))).toBe(true)
  })

  it('et le PDF aussi — sans dupliquer le générateur', () => {
    expect(existsSync(join(dir, 'pdf/route.ts'))).toBe(true)
    const route = readFileSync(join(dir, 'pdf/route.ts'), 'utf8')
    expect(route).toContain("from '@/app/(field)/m/visite/[reportId]/pdf/route'")
  })

  it('la surface desktop du CR compose les MÊMES composants que le terrain', () => {
    const cr = readFileSync(join(dir, 'compte-rendu/page.tsx'), 'utf8')
    for (const composant of ['CrDocumentSections', 'CrConcretisation', 'MemoriaRetained']) {
      expect(cr).toContain(`from '@/app/(field)/m/visite/[reportId]/cr/${composant}'`)
    }
    // Ouvrir n'a jamais voulu dire régénérer.
    expect(cr).toContain('getOrCreateVisitCrDocument')
  })
})

// ── LE MOT DIT LES DEUX GESTES ─────────────────────────────────────────────
//
// « Commencer l'arbitrage » ne suggérait pas qu'on peut aussi corriger le texte.
// Or c'est exactement ce qu'on fait en ouvrant le compte-rendu : on relit, on
// rectifie, puis on tranche.

describe('les libellés annoncent la relecture autant que la décision', () => {
  const desk = readFileSync(join(dir, 'VisitDesk.tsx'), 'utf8')

  it('le geste principal parle de relire ET d’arbitrer', () => {
    expect(rendu).toContain('Relire et arbitrer')
    expect(rendu).not.toMatch(/Commencer l’arbitrage/)
  })

  it('le renvoi vers les autres propositions aussi', () => {
    expect(desk).toMatch(/Relire et arbitrer les \{restant\} autres propositions/)
  })

  it('les propositions sont prêtes en arrivant sur le compte-rendu', () => {
    // Au bureau on ouvre le CR POUR arbitrer : différer leur chargement d'un
    // clic était un obstacle sans raison. Aucun coût caché — cette branche
    // n'existe que si l'analyse est déjà en cache.
    const cr = readFileSync(join(dir, 'compte-rendu/page.tsx'), 'utf8')
    expect(cr).not.toContain('autoLoad={false}')
  })
})
