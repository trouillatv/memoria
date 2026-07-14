import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * MASQUER N'EST PAS INTERDIRE.
 *
 * Le menu (components/layout/nav-items.ts) ne montre à un chef d'équipe que
 * /planning et /glossaire. Mais le layout du dashboard ne contrôle PAS le rôle :
 * chaque page devait se garder elle-même. Quinze l'avaient oublié — contrats,
 * dossiers de démarrage, bibliothèque, fiche client, photos du chantier. Il
 * suffisait de taper l'URL pour entrer.
 *
 * Une défense qui doit être réécrite à la main dans quatre-vingt-treize fichiers
 * finit toujours par être oubliée une fois de plus. Ce test est la mémoire de cet
 * oubli : toute NOUVELLE page du dashboard doit se garder, ou être inscrite
 * ci-dessous — ce qui force à écrire pourquoi elle est ouverte.
 */

const DASHBOARD = join(process.cwd(), 'app', '(dashboard)')

/**
 * Les pages LÉGITIMEMENT ouvertes à un chef d'équipe. Toute ligne ajoutée ici
 * est une décision d'ouverture, et doit être justifiée.
 */
const OPEN_ON_PURPOSE: Record<string, string> = {
  'planning/page.tsx': "Le planning EST l'écran du chef d'équipe (nav-items l'y autorise).",
  'glossaire/page.tsx': "Lecture ouverte à tous ; seul l'admin édite (canEdit).",
  'account/page.tsx': "Son propre compte : chacun voit le sien, quel que soit son rôle.",
  'account/password/page.tsx': "Son propre mot de passe : chacun change le sien.",
  // Redirections pures : la page cible porte le contrôle.
  'calendrier-scolaire/page.tsx': 'Redirige vers /calendrier, qui est gardée.',
  'continuite/page.tsx': 'Redirige vers /handovers, qui est gardée.',
  'preparation/page.tsx': 'Redirige vers /sites, qui est gardée.',
  'sites/[id]/ao/page.tsx': 'Redirige vers /dossiers ou /opportunites, qui sont gardées.',
  'sites/[id]/carte/page.tsx': 'Redirige vers la chronique du chantier, qui est gardée.',
  // Ouvertes par nécessité — voir la note en fin de fichier.
  'interventions/[id]/page.tsx':
    "Atteignable depuis /planning, l'écran du chef d'équipe : la fermer casserait son parcours. Son accès doit se restreindre à SON intervention, pas à son rôle — question distincte, non résolue ici.",
  // Écrans de développement : notFound() en production.
  'dev/engagements/page.tsx': 'notFound() si NODE_ENV === production.',
  'dev/field/page.tsx': 'notFound() si NODE_ENV === production.',
}

/**
 * Un contrôle de rôle, sous l'une des formes réellement employées dans le dépôt.
 *
 * Un faux négatif est sans danger : le test échoue, un humain regarde. C'est un
 * faux positif qui serait grave — une page qui SEMBLE gardée. Donc on ne
 * reconnaît que des formes qui gardent vraiment.
 */
const GATE_PATTERNS = [
  /requireDeskUser\s*\(/,
  /user\.role\s*!==\s*'admin'/,
  /user\.role\s*===\s*'chef_equipe'/,
  /role\s*!==\s*'admin'/,
  /role\s*===\s*'chef_equipe'/,
  /isPrivileged/,
  /canViewDocument\s*\(/,
  // Garde propre aux fiches personne : autorise aussi la personne elle-même.
  /checkIntervenantsPageAccess\s*\(/,
]

function listPages(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listPages(full))
    else if (entry === 'page.tsx') out.push(full)
  }
  return out
}

describe('Les pages du dashboard', () => {
  const pages = listPages(DASHBOARD)

  it('existent en nombre (le test parcourt bien quelque chose)', () => {
    expect(pages.length).toBeGreaterThan(50)
  })

  it('contrôlent toutes le rôle, ou sont déclarées ouvertes explicitement', () => {
    const unguarded: string[] = []

    for (const page of pages) {
      const key = relative(DASHBOARD, page).split(sep).join('/')
      if (key in OPEN_ON_PURPOSE) continue

      const src = readFileSync(page, 'utf8')
      if (!GATE_PATTERNS.some((re) => re.test(src))) unguarded.push(key)
    }

    expect(
      unguarded,
      `Ces pages du dashboard n'ont AUCUN contrôle de rôle : un chef d'équipe y entre en tapant l'URL.\n` +
        `Ajoute \`await requireDeskUser()\` en tête de la fonction, ou inscris la page dans OPEN_ON_PURPOSE en disant pourquoi elle est ouverte.\n\n` +
        unguarded.map((p) => `  - ${p}`).join('\n'),
    ).toEqual([])
  })

  it("n'ouvrent pas une page sans en donner la raison", () => {
    for (const [page, reason] of Object.entries(OPEN_ON_PURPOSE)) {
      expect(reason.length, `${page} est déclarée ouverte sans raison écrite`).toBeGreaterThan(20)
    }
  })
})
