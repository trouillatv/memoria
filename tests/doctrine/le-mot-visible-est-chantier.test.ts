import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

/**
 * « SITE » EST LE MOT DE LA BASE. « CHANTIER » EST LE MOT DE GUILLAUME.
 *
 * Le conducteur de travaux ne dit jamais « site ». Il dit « chantier ». La PR #182
 * a posé la règle, la PR #188 a posé ce garde-fou — mais il LISAIT LIGNE PAR LIGNE,
 * avec une expression régulière. Deux conséquences :
 *
 *   1. Toute phrase JSX répartie sur plusieurs lignes lui était invisible. C'est
 *      la forme NORMALE d'un paragraphe : il en manquait une centaine, dont
 *      l'en-tête de colonne du planning et la moitié des écrans de passation.
 *   2. Les toasts lui échappaient entièrement (« Site créé », « Choisis un site »).
 *
 * Il lit désormais l'ARBRE SYNTAXIQUE : les nœuds de texte JSX, les props
 * d'affichage, et le premier argument des toasts. Un nœud de texte ne connaît pas
 * les retours à la ligne du fichier — la coupure d'un paragraphe ne le cache plus.
 * Et comme il ne lit plus que du texte, il ne peut plus confondre `view === 'site'`
 * ou `useState<Site[]>` avec une phrase : zéro faux positif, donc zéro raison de
 * l'assouplir un jour.
 *
 * La règle qu'il tient : `site` reste partout dans le CODE (site_id, from('sites'),
 * la route /sites), et disparaît de ce que l'utilisateur LIT.
 */

const ROOTS = ['app', 'components'].map((r) => join(process.cwd(), r))

/** Props dont la valeur finit sous les yeux de l'utilisateur. */
const DISPLAY_PROPS = new Set([
  'label', 'placeholder', 'title', 'description', 'emptyLabel', 'searchPlaceholder', 'alt', 'aria-label',
])
/** Un toast est une phrase, pas un log. */
const TOAST = /^toast(\.(success|error|info|warning|message|loading))?$/
const SAYS_SITE = /\bsites?\b/i

/**
 * Écrans où « site » n'est PAS le chantier de Guillaume. Toute entrée dit pourquoi.
 */
const NOT_THE_CHANTIER: Record<string, string> = {
  // La landing parle au MARCHÉ, pas à Guillaume : « entreprises multi-sites —
  // propreté, maintenance, services et BTP ». Y écrire « chantier » exclurait la
  // moitié du public visé. Le mot y désigne l'implantation, pas le dossier suivi.
  'app/LandingPage.tsx': 'Page publique — vocabulaire de marché (multi-sites), pas le chantier suivi.',
  // Écran de diagnostic interne : il compte les LIGNES DE LA TABLE `sites`.
  'app/(dashboard)/dev/field/page.tsx': 'Diagnostic développeur — nomme les tables, pas les écrans.',
}

function listTsx(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listTsx(full))
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Tout ce que l'utilisateur LIT dans un fichier — et rien d'autre. */
function visibleTexts(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const keep = (raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (text.length >= 3) out.push(text)
  }
  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      keep(node.text)
    } else if (ts.isJsxAttribute(node) && DISPLAY_PROPS.has(node.name.getText(sf))) {
      const init = node.initializer
      if (init && ts.isStringLiteral(init)) keep(init.text)
    } else if (ts.isPropertyAssignment(node) && DISPLAY_PROPS.has(node.name.getText(sf).replace(/['"]/g, ''))) {
      const init = node.initializer
      if (ts.isStringLiteral(init)) keep(init.text)
    } else if (ts.isCallExpression(node) && TOAST.test(node.expression.getText(sf))) {
      const first = node.arguments[0]
      if (first && ts.isStringLiteral(first)) keep(first.text)
    }
    node.forEachChild(walk)
  }
  walk(sf)
  return out
}

describe("Le mot que l'utilisateur lit", () => {
  const files = ROOTS.flatMap(listTsx)

  it('parcourt bien les écrans', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('voit une phrase coupée en plusieurs lignes — le trou de la version précédente', () => {
    const coupée = `
      export function A() {
        return (
          <p>
            Aucune anomalie ouverte sur ce
            site pour le moment.
          </p>
        )
      }
    `
    const textes = visibleTexts(coupée, 'coupée.tsx')
    expect(textes.some((t) => SAYS_SITE.test(t))).toBe(true)
  })

  it("ne confond pas le code avec une phrase — aucun faux positif", () => {
    const code = `
      export function B({ view }: { view: 'site' | 'team' }) {
        const [sites, setSites] = useState<Site[]>([])
        const rows = view === 'site' ? bySite(sites) : byTeam(sites)
        return <Link href="/sites">{rows.length}</Link>
      }
    `
    expect(visibleTexts(code, 'code.tsx').filter((t) => SAYS_SITE.test(t))).toEqual([])
  })

  it('est « chantier », jamais « site »', () => {
    const offenders: string[] = []

    for (const file of files) {
      const key = relative(process.cwd(), file).split(sep).join('/')
      if (key in NOT_THE_CHANTIER) continue

      for (const text of visibleTexts(readFileSync(file, 'utf8'), file)) {
        if (SAYS_SITE.test(text)) offenders.push(`${key} — « ${text} »`)
      }
    }

    expect(
      Array.from(new Set(offenders)),
      `Ces textes disent « site » à l'utilisateur. Il dit « chantier ».\n` +
        `« site » reste le mot de la base (site_id, from('sites')) — pas celui de l'écran.\n` +
        `Si le mot ne désigne vraiment pas un chantier, inscris l'écran dans NOT_THE_CHANTIER avec sa raison.\n`,
    ).toEqual([])
  })
})
