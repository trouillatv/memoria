import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Fiche Document — deuxième objet du Lot 4 ─────────────────────────────────
// getSiteDocumentFiche est server-only → invariants protégés par lecture de
// source, comme decision-fiche.doctrine et reunion-fiche.doctrine.
//
// Ce fichier protège surtout ce qui est ADJACENT AUX AUTORISATIONS : la fiche
// ouvre une porte de plus sur un objet role-gaté, et une porte se laisse
// facilement élargir par inadvertance.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const model = read('lib/knowledge/document-fiche.ts')
const body = read('app/(dashboard)/sites/[id]/views/document/DocumentFiche.tsx')
const intercept = read('app/(dashboard)/sites/[id]/@fiche/(.)document/[documentId]/page.tsx')

describe('getSiteDocumentFiche — la porte n’est pas plus large que la visionneuse', () => {
  it('le RÔLE décide, via la même fonction que la visionneuse', () => {
    expect(model).toContain("from '@/lib/documents/access'")
    expect(model).toContain('if (!canViewDocument(role, d.visibility_level)) return null')
  })

  it('le LITIGE ne circule pas dans le graphe', () => {
    expect(model).toContain("if (d.document_type === 'litige') return null")
  })

  it('le document doit être RATTACHÉ à ce chantier (garde IDOR)', () => {
    // Sans ce lien, `/sites/<A>/document/<X>` ouvrirait un document d'un autre
    // chantier au seul motif qu'il existe.
    expect(model).toMatch(/from\('document_links'\)[\s\S]*?eq\('target_type', 'site'\)[\s\S]*?eq\('target_id', siteId\)/)
    expect(model).toContain('if (!lienSiteRes.data) return null')
  })

  it('garde org fail-closed, des deux côtés (chantier ET document)', () => {
    expect(model).toContain('getOrgId')
    expect(model).toMatch(/site\.organization_id !== orgId/)
    expect(model).toMatch(/d\.organization_id !== orgId/)
  })

  it('un document supprimé n’ouvre rien', () => {
    expect(model).toContain('if (!d || d.deleted_at) return null')
  })

  it('la route interceptée exige un utilisateur et ne révèle pas l’existence', () => {
    expect(intercept).toContain('getCurrentUserWithProfile')
    expect(intercept).toContain('user.role')
    expect(intercept).toContain('notFound()')
  })
})

describe('Fiche Document — la grammaire, appliquée', () => {
  it('chapô : UNE réserve → nommée ; PLUSIEURS → ni compte ni élue ; AUCUNE → pas de chapô', () => {
    expect(body).toMatch(/label: 'Justifie', title: seule\.label/)
    expect(body).toContain("label: 'Justifie plusieurs réserves', title: null")
    expect(body).toMatch(/const chapo: Chapo \| null =[\s\S]*?:\s*null\n/)
  })

  it('sans réunion source, aucun fil n’est fabriqué', () => {
    expect(body).toMatch(/\.\.\.\(d\.reunion \? \[\{ typeLabel: 'Réunion'/)
  })

  it('la date DIT ce qu’elle est — effet ou dépôt, jamais confondues', () => {
    expect(model).toContain('dateIsEffective')
    expect(body).toContain("d.dateIsEffective ? 'En vigueur au' : 'Déposé le'")
  })

  it('l’état vide est honnête sur sa CAUSE (aucun lien enregistré ≠ aucune preuve)', () => {
    expect(body).toContain('Aucune réserve rattachée à ce document.')
  })

  it('la visionneuse est une SORTIE nommée, pas la destination', () => {
    expect(body).toContain('Ouvrir le document')
    expect(model).toMatch(/visionneuseHref: `\/documents\/\$\{d\.id\}`/)
  })
})

describe('Ce que la fiche NE prétend PAS savoir', () => {
  it('aucun lien document → action ou décision n’est fabriqué', () => {
    // `document_links.target_type` ne connaît ni action ni décision. Inventer
    // cette relation donnerait une causalité que la base n'enregistre pas.
    expect(model).not.toMatch(/target_type', 'action'/)
    expect(model).not.toMatch(/target_type', 'decision'/)
    expect(model).not.toContain('site_decisions')
    expect(model).not.toContain('site_actions')
  })
})
