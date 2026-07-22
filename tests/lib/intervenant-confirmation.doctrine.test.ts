import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── LA CONFIRMATION D'UNE PERSONNE — deux quasi-bugs à ne jamais réintroduire ─
// Cadrage validé 2026-07-18 (« correction structurante du cycle de
// confirmation ») :
//
// 1. Confirmer « Vincent Milon (PAVE) » créait une ENTREPRISE « Vincent
//    Milon » : la promotion stakeholder ne savait pas dire « personne » —
//    findOrCreateCompanyByName recevait le titre brut.
//
// 2. Confirmer faisait DISPARAÎTRE la personne d'Explorer : le graphe ne
//    créait des nœuds acteur que depuis les propositions 'proposed'. La
//    confirmation, qui devrait enrichir la connaissance, la faisait régresser.
//
// Même famille que confirmed-never-vanishes : un fait confirmé ne s'évapore
// jamais, et confirmer n'écrit jamais autre chose que ce que l'humain a dit.

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

describe('Confirmer une personne crée une personne, jamais une entreprise à son nom', () => {
  const src = codeOf('lib/db/knowledge-proposals.ts')

  it('la branche stakeholder sait créer un contact (mig 137)', () => {
    expect(src).toContain('findOrCreateCompanyContact')
  })

  it("une personne sans entreprise est rattachée à l'entreprise placeholder « À identifier », jamais à une société inventée à son nom", () => {
    // Doctrine mise à jour (mig 232) : REFUSER n'était pas la bonne réponse — sur
    // un chantier on croise quelqu'un avant de savoir pour qui il travaille.
    // Désormais, une personne sans société nommée rejoint l'entreprise d'ATTENTE
    // « À identifier » (findOrCreatePlaceholderCompany). L'invariant de mig 137
    // tient toujours : on ne fabrique JAMAIS une entreprise au nom de la personne
    // (`p.title`), ce serait recréer le bug.
    expect(src).toContain('findOrCreatePlaceholderCompany')
    expect(src).toMatch(/personName[\s\S]{0,320}?findOrCreatePlaceholderCompany\(orgId\)/)
  })

  it('la promotion trace le LIEN exact du casting, plus seulement l’entreprise', () => {
    // promoted_object_id = l'id du lien site_intervenants : c'est lui qui permet
    // de retrouver les mentions d'une personne depuis l'objet confirmé.
    expect(src).toMatch(/objectType: 'site_intervenant', objectId: intervenantId/)
  })
})

describe("Confirmer ne fait jamais disparaître du moteur de relations", () => {
  const graph = codeOf('lib/knowledge/site-graph.ts')

  it('le graphe lit le casting CONFIRMÉ, pas seulement les propositions', () => {
    expect(graph).toContain('listSiteIntervenants')
    // Le nœud d'un intervenant confirmé.
    expect(graph).toContain('int_')
  })

  it('les mentions confirmées rejoignent leur intervenant (nouvel id ET ancien)', () => {
    // promoted_object_id vise le lien du casting (nouvelles promotions) ou
    // l'entreprise (lignes promues avant le traçage du lien) — les DEUX doivent
    // rester résolubles, sinon l'historique perd ses mentions.
    expect(graph).toMatch(/intNodeByObjectId\.set\(it\.id/)
    expect(graph).toMatch(/intNodeByObjectId\.set\(it\.companyId/)
  })
})
