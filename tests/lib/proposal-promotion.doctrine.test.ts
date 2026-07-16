import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROMOTABLE_KINDS, canPromote, promotionLabel, promotionNeedsRole, whyNotPromotable,
} from '@/lib/db/knowledge-proposals'

const SOURCE = join(process.cwd(), 'lib/db/knowledge-proposals.ts')
const MIGRATION = join(process.cwd(), 'supabase/migrations/212_site_knowledge_proposals.sql')

/** Le corps d'une fonction exportée : de sa déclaration au prochain `export`.
 *  (Une regex non-gourmande s'arrêterait sur l'accolade du bloc de paramètres.) */
function bodyOf(name: string): string {
  const src = readFileSync(SOURCE, 'utf8')
  const start = src.indexOf(`export async function ${name}`)
  expect(start, `${name} est introuvable`).toBeGreaterThan(-1)
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

// ── LA RÈGLE DE SORTIE ───────────────────────────────────────────────────────
// « Aucun bouton visible ne doit pouvoir lever "promotion non supportée". Chaque
// type affiché possède soit un geste métier fonctionnel, soit uniquement
// "Écarter" avec une explication honnête. » (Vincent, 2026-07-17)
//
// C'est ce qui a manqué : promoteProposal ne gérait que action et deadline, et
// les 4 autres types levaient une exception. Personne ne pouvait confirmer
// « Vincent Milon — PAVE » — le vide de la Mémoire n'était pas de l'UX, c'était
// un cycle métier incomplet. La règle ne tient que si les écrans DÉRIVENT leurs
// boutons d'ici au lieu de les deviner.
describe('La règle de sortie — un geste réel, ou rien', () => {
  it('tout kind de la base est soit promouvable, soit expliqué', () => {
    // Les kinds réels viennent de la migration, jamais d'une liste recopiée : le
    // jour où un 7ᵉ type apparaît en base, ce test le réclame ici.
    const sql = readFileSync(MIGRATION, 'utf8')
    const kinds = (sql.match(/CHECK \(kind IN \(([^)]+)\)\)/)?.[1] ?? '')
      .split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(kinds.length).toBe(6)

    for (const k of kinds) {
      const promouvable = canPromote(k)
      const explique = whyNotPromotable(k) !== null
      expect(
        promouvable !== explique,
        `« ${k} » doit avoir SOIT un geste métier, SOIT une explication honnête — jamais les deux, jamais aucun`,
      ).toBe(true)
    }
  })

  it('chaque type promouvable porte un verbe métier, jamais « Confirmer » générique', () => {
    for (const k of PROMOTABLE_KINDS) {
      const label = promotionLabel(k)
      expect(label, `« ${k} » n'a pas de geste`).toBeTruthy()
      expect(label, 'un bouton « Confirmer » nu ne dit pas ce qui va se passer').not.toBe('Confirmer')
    }
    expect(promotionLabel('action')).toBe("Créer l'action")
    expect(promotionLabel('deadline')).toBe('Ajouter au planning')
  })

  it("un type non promouvable n'a AUCUN geste", () => {
    expect(promotionLabel('knowledge')).toBeNull()
    expect(promotionLabel('vigilance')).toBeNull()
    expect(canPromote('knowledge')).toBe(false)
    expect(canPromote('vigilance')).toBe(false)
  })

  it('la liste des promouvables correspond à ce que le code sait vraiment faire', () => {
    // Le garde-fou du garde-fou : si quelqu'un ajoute 'knowledge' à
    // PROMOTABLE_KINDS sans écrire sa branche, promoteProposal lèverait encore
    // « non supportée » — et le bouton apparaîtrait. On compare donc la liste
    // aux branches réellement écrites.
    const fn = bodyOf('promoteProposal')
    for (const k of PROMOTABLE_KINDS) {
      expect(fn, `PROMOTABLE_KINDS annonce « ${k} » mais promoteProposal n'a pas sa branche`)
        .toMatch(new RegExp(`p\\.kind === '${k}'`))
    }
  })
})

// ── LE RÔLE NE SE DEVINE PAS ─────────────────────────────────────────────────
// `analysis.intervenants` est un string[] (« Ginger », « Électriciens ») et son
// payload est vide. Or site_intervenants exige un rôle NOT NULL. Le deviner —
// « Électriciens » ⇒ rôle ELEC ? — serait inventer un casting que personne n'a
// dit. On le demande. (Vérifié en base : un intervenant sans rôle est refusé.)
describe("L'intervenant — le rôle se demande, il ne se déduit pas", () => {
  it('seul un intervenant réclame un rôle', () => {
    expect(promotionNeedsRole('stakeholder')).toBe(true)
    expect(promotionNeedsRole('decision')).toBe(false)
    expect(promotionNeedsRole('action')).toBe(false)
  })

  it('la promotion refuse plutôt que de fabriquer un rôle', () => {
    const src = readFileSync(SOURCE, 'utf8')
    expect(src).toContain('ROLE_REQUIS')
  })
})

// ── ÉCARTER EST TOUJOURS POSSIBLE ────────────────────────────────────────────
// dismissProposal est agnostique du kind : dire « ça n'a pas lieu d'être » ne
// dépend pas de l'existence d'une cible métier. C'est ce qui permet d'être
// honnête tout de suite sur vigilance et knowledge.
describe('Écarter — disponible pour tous les types', () => {
  it('dismissProposal ne filtre sur aucun kind', () => {
    expect(bodyOf('dismissProposal'), 'écarter ne doit dépendre d’aucun type')
      .not.toMatch(/kind === '|canPromote\(/)
  })
})
