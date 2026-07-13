// ⚖️ LE LITIGE NE REMONTE JAMAIS DANS LA RECHERCHE.
//
// Décision produit de Vincent (2026-07-14) : le texte extrait des documents entre
// dans la recherche transverse, à l'exception STRICTE des `document_type =
// 'litige'`.
//
// Le risque n'est pas théorique : afficher un extrait contentieux parmi des
// résultats ordinaires sort une phrase de son contexte, expose une position
// juridique, mélange un fait de chantier et une allégation — et se fait reprendre
// ensuite comme une vérité établie.
//
// Ce fichier est un TRIPWIRE. Il ne teste pas une fonction : il lit la migration
// et vérifie que les deux barrières sont toujours là. Si quelqu'un les retire un
// jour « pour simplifier », la CI tombe.
//
// (La preuve fonctionnelle, elle, a été faite contre la VRAIE base : un document
// ordinaire remonte, un litige non, et un document reclassé en litige disparaît
// à la requête suivante.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SQL = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '204_search_memory_documents.sql'),
  'utf-8',
)

describe('⚖️ Le filtre litige vit dans la SOURCE, pas dans l’écran', () => {
  it('BARRIÈRE 1 — l’index des documents est PARTIEL : un litige n’y entre pas', () => {
    // Structurelle : même une requête mal écrite ne peut pas remonter un litige
    // PAR CET INDEX.
    const idx = /create index if not exists documents_tsv_idx[\s\S]*?;/i.exec(SQL)?.[0] ?? ''
    expect(idx).toMatch(/using gin \(tsv\)/i)
    expect(idx).toMatch(/where[\s\S]*document_type <> 'litige'/i)
  })

  it('BARRIÈRE 2 — la RPC filtre explicitement le litige', () => {
    // La CTE des documents doit porter le filtre. Deux barrières indépendantes :
    // retirer l'une ne suffit pas à faire fuiter.
    const cte = /document_hits as \([\s\S]*?\n  \)/i.exec(SQL)?.[0] ?? ''
    expect(cte).not.toBe('')
    expect(cte).toMatch(/doc\.document_type <> 'litige'/i)
  })

  it('le filtre porte sur le TYPE, pas sur un statut ni un tag — on ne le contourne pas', () => {
    expect(SQL).not.toMatch(/document_type = 'litige'/i) // jamais une inclusion
  })

  it('un document RETIRÉ ne remonte pas non plus', () => {
    const cte = /document_hits as \([\s\S]*?\n  \)/i.exec(SQL)?.[0] ?? ''
    expect(cte).toMatch(/doc\.deleted_at is null/i)
  })

  it('un document SANS texte extrait ne produit pas un résultat vide', () => {
    const cte = /document_hits as \([\s\S]*?\n  \)/i.exec(SQL)?.[0] ?? ''
    expect(cte).toMatch(/doc\.extracted_text is not null/i)
  })

  it('l’extrait montre la phrase AUTOUR du mot — pas la page de garde', () => {
    const cte = /document_hits as \([\s\S]*?\n  \)/i.exec(SQL)?.[0] ?? ''
    expect(cte).toMatch(/ts_headline/i)
  })

  it('un document reclassé en litige sort du corpus SANS désindexation', () => {
    // Le filtre est évalué À LA LECTURE : il n'y a rien à « désindexer », donc
    // rien qui puisse être oublié. C'est ce qui rend la règle increvable.
    const cte = /document_hits as \([\s\S]*?\n  \)/i.exec(SQL)?.[0] ?? ''
    expect(cte).toMatch(/where[\s\S]*doc\.document_type <> 'litige'/i)
  })
})
