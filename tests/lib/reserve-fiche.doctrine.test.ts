import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Fiche Réserve — troisième objet du Lot 4 ─────────────────────────────────
// getSiteReserveFiche est server-only → invariants protégés par lecture de source.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const model = read('lib/knowledge/reserve-fiche.ts')
const body = read('app/(dashboard)/sites/[id]/views/reserve/ReserveFiche.tsx')

describe('getSiteReserveFiche — factuel et fail-closed', () => {
  it('garde org fail-closed + scope chantier', () => {
    expect(model).toContain('getOrgId')
    expect(model).toMatch(/site\.organization_id !== orgId/)
    expect(model).toMatch(/from\('site_reserve'\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('UNE seule vague de lectures', () => {
    const waves = model.match(/await Promise\.all\(/g) ?? []
    expect(waves).toHaveLength(1)
    expect(model).toMatch(/Promise\.all\(\[\s*\n\s*getOrgId\(\)/)
  })

  it('les actions qui corrigent sont scopées au chantier (garde IDOR)', () => {
    expect(model).toMatch(/from\('site_actions'\)[\s\S]*?eq\('reserve_id', reserveId\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('le statut est dérivé du champ, jamais d’une inférence', () => {
    expect(model).toContain("const levee = r.status === 'lifted'")
  })
})

describe('Une réserve se LÈVE — le mot du métier, pas un synonyme', () => {
  it('aucun vocabulaire de substitution dans le modèle ni à l’écran', () => {
    // « Résolue », « fermée », « terminée » diraient autre chose : la levée est
    // un acte contractuel constaté, pas un état de tâche.
    // On regarde le CODE, pas les commentaires : ceux-ci citent justement les
    // mots proscrits pour expliquer pourquoi ils le sont.
    const sansCommentaires = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    for (const src of [model, body]) {
      expect(sansCommentaires(src)).not.toMatch(/résolue|resolue/i)
      expect(sansCommentaires(src)).not.toMatch(/réserve fermée|reserve fermee/i)
    }
    expect(model).toContain("statutLabel: levee ? 'Levée' : 'Ouverte — à lever'")
  })

  it('la note de levée est reprise telle quelle, jamais reformulée', () => {
    expect(model).toContain('noteLevee: r.lift_note?.trim() || null')
    expect(body).toContain('{r.noteLevee}')
  })
})

describe('Fiche Réserve — la grammaire, appliquée une troisième fois', () => {
  it('chapô : UNE action → nommée ; PLUSIEURS → ni compte ni élue ; AUCUNE → pas de chapô', () => {
    expect(body).toMatch(/label: 'Corrigée par', title: seule\.titre/)
    expect(body).toContain("label: 'Corrigée par plusieurs actions', title: null")
    expect(body).toMatch(/const chapo: Chapo \| null =[\s\S]*?:\s*null\n/)
  })

  it('le maillon Action du fil n’est cliquable que s’il est unique', () => {
    expect(body).toContain('href: seule?.href ?? null')
  })

  it('le SUJET traverse la chaîne — il n’est pas un maillon du fil', () => {
    // Objet transverse (6ᵉ règle) : il vit dans le corps, pas dans le fil.
    expect(body).not.toMatch(/typeLabel: 'Sujet'/)
    expect(body).toContain('Sujet suivi')
  })

  it('quand le chapô nomme déjà l’action, le corps ne la répète pas', () => {
    // Règle 4 : une information n'est expliquée qu'une seule fois.
    expect(body).toContain('r.actions.length !== 1 &&')
  })
})

describe('La preuve photo est ANNONCÉE, jamais simulée', () => {
  it('le modèle rend un booléen, pas un chemin de stockage', () => {
    expect(model).toContain('photoAvant: Boolean(r.photo_before_path)')
    expect(model).not.toMatch(/photoAvant: r\.photo_before_path[^)]/)
  })

  it('l’écran dit où la voir plutôt que de prétendre l’afficher', () => {
    expect(body).toContain('à voir dans les réserves du chantier')
  })
})
