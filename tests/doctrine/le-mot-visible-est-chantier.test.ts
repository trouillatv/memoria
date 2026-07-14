import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * « SITE » EST LE MOT DE LA BASE. « CHANTIER » EST LE MOT DE GUILLAUME.
 *
 * Le conducteur de travaux ne dit jamais « site ». Il dit « chantier ». La PR #182
 * a posé la règle et renommé la navigation — mais quarante-quatre textes lui
 * avaient échappé : « Aucun site ni contrat », « Sur quel site ? », « Choisir un
 * site », « Sommaire des sites concernés » (page publique !)…
 *
 * Le mot restait donc à l'écran, à côté du mot juste. Le même objet portait deux
 * noms selon la page — la confusion exacte que #182 voulait supprimer.
 *
 * Ce test tient la règle : `site` reste partout dans le CODE (site_id,
 * from('sites'), view === 'site'), et disparaît de ce que l'utilisateur LIT.
 * Il ne lit que le texte JSX et les libellés affichés — jamais les identifiants.
 */

const ROOTS = ['app', 'components'].map((r) => join(process.cwd(), r))

/** Texte lu par l'utilisateur : contenu JSX, et props d'affichage. */
const JSX_TEXT = />([^<>{}\n]{3,140})</g
const DISPLAY_PROP =
  /\b(?:label|placeholder|title|description|emptyLabel|searchPlaceholder)\s*[=:]\s*['"]([^'"\n]{3,140})['"]/g

const SAYS_SITE = /\bsites?\b/i
/** Identifiants, chemins, clés — pas du texte. */
const IS_IDENTIFIER = /^[\w.\-[\]/${}]+$/

/**
 * Textes où « site » ne désigne PAS le chantier de Guillaume. Toute ligne
 * ajoutée ici est une exception, et doit dire pourquoi.
 */
const NOT_THE_CHANTIER: Record<string, string> = {
  'Appel d’offres — marché de services multi-sites':
    "Français commercial standard sur la page d'accueil publique — ce n'est pas le chantier suivi.",
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

describe("Le mot que l'utilisateur lit", () => {
  const files = ROOTS.flatMap(listTsx)

  it('parcourt bien les écrans', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("est « chantier », jamais « site »", () => {
    const offenders: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const key = relative(process.cwd(), file).split(sep).join('/')

      for (const line of src.split('\n')) {
        const trimmed = line.trim()
        // Les commentaires parlent aux développeurs : « site » y est légitime.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

        for (const re of [JSX_TEXT, DISPLAY_PROP]) {
          re.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = re.exec(line)) !== null) {
            const text = (m[1] ?? '').trim()
            if (!SAYS_SITE.test(text)) continue
            if (IS_IDENTIFIER.test(text)) continue
            if (text in NOT_THE_CHANTIER) continue
            offenders.push(`${key} — « ${text} »`)
          }
        }
      }
    }

    expect(
      Array.from(new Set(offenders)),
      `Ces textes disent « site » à l'utilisateur. Il dit « chantier ».\n` +
        `« site » reste le mot de la base (site_id, from('sites')) — pas celui de l'écran.\n` +
        `Si le mot ne désigne vraiment pas un chantier, inscris-le dans NOT_THE_CHANTIER avec sa raison.\n`,
    ).toEqual([])
  })
})
