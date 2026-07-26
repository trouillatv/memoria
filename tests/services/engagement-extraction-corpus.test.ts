// L'agent d'extraction lit le DOSSIER, pas la première pièce.
//
// Régression : le message construit tronquait le corpus à 12 000 caractères
// (constante mono-document héritée). Depuis le multipièces (buildTenderCorpus,
// 30 000, part équitable), cette troncature rejetait par POSITION les pièces
// déposées en fin de corpus — l'IA n'en voyait que 2-3. Ce test verrouille
// l'invariant : les en-têtes de TOUTES les pièces survivent jusqu'à l'entrée
// du LLM.

import { describe, expect, it } from 'vitest'
import { buildEngagementExtractionMessage } from '@/services/ai/engagement-extraction'
import { buildTenderCorpus, tenderPieceLabel, TENDER_CORPUS_BUDGET, type TenderPiece } from '@/lib/tenders/pieces'

// Six pièces d'un vrai dossier ; chacune assez fournie pour que le corpus
// dépasse l'ancienne fenêtre de 12 000 et que les dernières pièces tombent
// au-delà de ce seuil (là où l'ancien slice les supprimait).
const filler = (marker: string) => `${marker} ` + 'clause contractuelle détaillée '.repeat(180)
const PIECES: TenderPiece[] = [
  { kind: 'ccap', filename: 'CCAP.pdf', text: filler('CCAP') },
  { kind: 'rc', filename: 'Reglement-consultation.pdf', text: filler('RC') },
  { kind: 'autre', filename: 'Programme-travaux.pdf', text: filler('PROG') },
  { kind: 'autre', filename: 'Avis-appel-offres.pdf', text: filler('AVIS') },
  { kind: 'plan', filename: 'Plan-RDC.pdf', text: filler('RDC') },
  { kind: 'plan', filename: 'Plan-toitures.pdf', text: filler('TOIT') },
]

function header(p: TenderPiece): string {
  return `=== ${tenderPieceLabel(p.kind)} — ${p.filename} ===`
}

describe('buildEngagementExtractionMessage — toutes les pièces atteignent le LLM', () => {
  const corpus = buildTenderCorpus(PIECES)
  const message = buildEngagementExtractionMessage(corpus, null)

  it('le corpus dépasse l\'ancienne fenêtre de 12 000 (sinon le test ne prouve rien)', () => {
    expect(corpus.length).toBeGreaterThan(12_000)
    // Au moins une pièce commence au-delà de 12 000 : l'ancien slice l'aurait perdue.
    const lastHeaderIndex = corpus.lastIndexOf(header(PIECES[PIECES.length - 1]!))
    expect(lastHeaderIndex).toBeGreaterThan(12_000)
  })

  it('les SIX en-têtes de pièces survivent jusqu\'à l\'entrée du LLM', () => {
    for (const p of PIECES) {
      expect(message, `en-tête manquant : ${p.filename}`).toContain(header(p))
    }
  })

  it('la fenêtre de lecture est alignée sur le budget du corpus (pas de coupe sous 30k)', () => {
    // buildTenderCorpus plafonne déjà à TENDER_CORPUS_BUDGET ; le message ne doit
    // pas rogner davantage la part AO en-deçà de ce budget.
    const aoSection = message.slice(
      message.indexOf('=== AO source (texte extrait) ==='),
      message.indexOf('=== Mémoire technique'),
    )
    expect(aoSection).toContain(corpus.slice(0, TENDER_CORPUS_BUDGET))
  })
})

describe('buildEngagementExtractionMessage — mémoire technique', () => {
  it('absente → « (non fourni) »', () => {
    expect(buildEngagementExtractionMessage('ao', null)).toContain('(non fourni)')
  })

  it('présente → incluse dans le message', () => {
    const msg = buildEngagementExtractionMessage('ao', 'engagement mémoire technique')
    expect(msg).toContain('engagement mémoire technique')
  })
})
