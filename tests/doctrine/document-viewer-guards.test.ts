// Phase 3 visionneuse — garde-fous (spec 2026-05-19, exigés par Vincent).
//
// Tests STRUCTURELS purs (zéro base → zéro flake). But : la bibliothèque est
// relisible, vérifiable, auditée — sans dérive personne, sans IA, sans
// route publique.
//
//   1. pas de route document publique ;
//   2. ouverture & téléchargement appellent l'audit ;
//   3. pas d'import orchestrator/agents/génération dans la visionneuse ;
//   4. aucun index/filtre personne-centric ; storage_path jamais exposé.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { canViewDocument } from '@/lib/documents/access'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const PAGE = 'app/(dashboard)/documents/[id]/page.tsx'
const DL = 'app/(dashboard)/documents/[id]/download/route.ts'

describe('canViewDocument — role-gaté, jamais personne', () => {
  it('admin voit tout, y compris admin_only', () => {
    for (const v of ['admin_only', 'manager', 'operations', 'field', 'client_portal'] as const) {
      expect(canViewDocument('admin', v)).toBe(true)
    }
  })
  it('manager voit tout SAUF admin_only', () => {
    expect(canViewDocument('manager', 'admin_only')).toBe(false)
    for (const v of ['manager', 'operations', 'field', 'client_portal'] as const) {
      expect(canViewDocument('manager', v)).toBe(true)
    }
  })
  it('chef_equipe et null → aucun accès visionneuse (périmètre phase 3)', () => {
    expect(canViewDocument('chef_equipe', 'field')).toBe(false)
    expect(canViewDocument(null, 'field')).toBe(false)
  })
})

describe('Garde-fou #1 — pas de route document publique', () => {
  it('la visionneuse est sous (dashboard), pas sous app/p ni public', () => {
    expect(existsSync(join(ROOT, PAGE)), 'page visionneuse attendue sous (dashboard)').toBe(true)
    // Aucune route documents hors du groupe authentifié (dashboard).
    for (const pub of [
      'app/p/documents',
      'app/(public)/documents',
      'app/documents',
    ]) {
      expect(existsSync(join(ROOT, pub)), `route documents publique interdite : ${pub}`).toBe(false)
    }
  })
})

describe('Garde-fou #2 — ouverture & téléchargement audités', () => {
  it('la page logue logAuditEvent action "opened"', () => {
    const src = read(PAGE)
    expect(/logAuditEvent\(\{[\s\S]*?action:\s*'opened'/.test(src)).toBe(true)
  })
  it('la route download logue logAuditEvent action "downloaded"', () => {
    const src = read(DL)
    expect(/logAuditEvent\(\{[\s\S]*?action:\s*'downloaded'/.test(src)).toBe(true)
  })
})

describe('Garde-fou #3 — visionneuse sans IA générative', () => {
  const FORBIDDEN =
    /services\/ai\/(orchestrator|initial-analysis|engagement-extraction|chat|agents|library-context)|@anthropic-ai|@google\/genai|\bgenerateText\b|\banalyzeTender\b|\bbuildLibraryContext\b|embed-knowledge-chunks|@\/lib\/documents\/analyze/
  for (const f of [PAGE, DL, 'lib/documents/access.ts']) {
    it(`${f} n'importe aucun module IA/génératif`, () => {
      const code = read(f)
        .split('\n')
        .filter((l) => {
          const t = l.trim()
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')
      expect(FORBIDDEN.test(code), `import IA interdit dans ${f}`).toBe(false)
    })
  }
})

describe('Garde-fou #4 — zéro personne-centric, storage_path jamais exposé', () => {
  it('ni la page ni la route ne filtrent/indexent par personne', () => {
    const PERSON = /[?&]agent=|[?&]user(_?id)?=|\.eq\(\s*'(user_id|created_by|agent_id)'|byUser|byAgent|personHistory/i
    for (const f of [PAGE, DL]) {
      const code = read(f)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n')
      expect(PERSON.test(code), `filtre personne-centric dans ${f}`).toBe(false)
    }
  })

  it('storage_path n\'est utilisé que pour createSignedUrl (jamais rendu)', () => {
    for (const f of [PAGE, DL]) {
      const usages = read(f)
        .split('\n')
        // Retire les commentaires de fin de ligne et les lignes commentées :
        // on ne vise QUE l'usage réel du token, pas une mention en commentaire.
        .map((l) => l.replace(/\/\/.*$/, ''))
        .filter((l) => /\bdoc\.storage_path\b/.test(l))
      expect(usages.length, `aucun usage doc.storage_path dans ${f}`).toBeGreaterThan(0)
      for (const u of usages) {
        expect(
          /createSignedUrl\(\s*doc\.storage_path\b/.test(u),
          `storage_path hors createSignedUrl dans ${f}: ${u.trim()}`,
        ).toBe(true)
      }
    }
  })

  it('canViewDocument prend un RÔLE, pas une identité', () => {
    const src = read('lib/documents/access.ts')
    expect(/canViewDocument\(\s*\n?\s*role:\s*UserRole/.test(src)).toBe(true)
    expect(/\buser_?id\b/i.test(src)).toBe(false)
  })
})
