import { describe, it, expect } from 'vitest'
import {
  detectPieceKind,
  buildTenderCorpus,
  tenderPieceLabel,
  TENDER_CORPUS_BUDGET,
  type TenderPiece,
} from '@/lib/tenders/pieces'

describe('nature des pièces d’un appel d’offres', () => {
  it('reconnaît les pièces à leur acronyme, quel que soit le séparateur', () => {
    // Le piège : dans « MARCHE_RC_2026 », l'underscore est un caractère de mot —
    // sans normalisation des séparateurs, le RC serait invisible.
    expect(detectPieceKind('MARCHE_RC_2026.pdf')).toBe('rc')
    expect(detectPieceKind('CCTP-lot3.pdf')).toBe('cctp')
    expect(detectPieceKind('02.CCAP.pdf')).toBe('ccap')
    expect(detectPieceKind('DPGF (lot 2).pdf')).toBe('dpgf')
    expect(detectPieceKind('bpu_2026.pdf')).toBe('bpu')
  })

  it('reconnaît les pièces à leur libellé en toutes lettres, accents compris', () => {
    expect(detectPieceKind('Règlement de consultation.pdf')).toBe('rc')
    expect(detectPieceKind('Cahier des clauses techniques particulières.pdf')).toBe('cctp')
    expect(detectPieceKind('cahier des clauses administratives.pdf')).toBe('ccap')
    expect(detectPieceKind('Bordereau des prix unitaires.pdf')).toBe('bpu')
    expect(detectPieceKind('Plans de masse.pdf')).toBe('plan')
    expect(detectPieceKind('Annexe 3.pdf')).toBe('annexe')
  })

  it('ne confond pas le CCTP et le CCAP, qui partagent « cahier des clauses »', () => {
    expect(detectPieceKind('CCTP.pdf')).not.toBe('ccap')
    expect(detectPieceKind('CCAP.pdf')).not.toBe('cctp')
  })

  it('ne voit pas un règlement de consultation dans « parc » ou « marché »', () => {
    // « rc » est une sous-chaîne de « parc » : sans frontière de mot, tout dossier
    // contenant « parc » serait étiqueté règlement de consultation.
    expect(detectPieceKind('parc-des-expositions.pdf')).toBeNull()
    expect(detectPieceKind('marche-public.pdf')).toBeNull()
  })

  it('assume de ne pas savoir plutôt que d’inventer une nature', () => {
    expect(detectPieceKind('document-1.pdf')).toBeNull()
    expect(tenderPieceLabel(null)).toBe('Pièce non qualifiée')
  })
})

describe('corpus soumis à l’analyse', () => {
  const piece = (filename: string, kind: TenderPiece['kind'], size: number): TenderPiece => ({
    filename,
    kind,
    text: 'x'.repeat(size),
  })

  it('donne sa part à CHAQUE pièce : le CCTP n’est jamais mangé par le RC', () => {
    // Le vrai danger : l'agent tronque à 30 000 caractères. Concaténer dans
    // l'ordre ferait disparaître la dernière pièce — celle qui porte le travail.
    const pieces = [
      piece('RC.pdf', 'rc', 100_000),
      piece('CCTP.pdf', 'cctp', 100_000),
      piece('BPU.pdf', 'bpu', 100_000),
    ]
    const corpus = buildTenderCorpus(pieces)

    expect(corpus).toContain('RC.pdf')
    expect(corpus).toContain('CCTP.pdf')
    expect(corpus).toContain('BPU.pdf')
    expect(corpus.length).toBeLessThanOrEqual(TENDER_CORPUS_BUDGET)
  })

  it('laisse les petites pièces entières et ne rogne que les grosses', () => {
    const pieces = [
      piece('BPU.pdf', 'bpu', 200),        // tient largement
      piece('CCTP.pdf', 'cctp', 100_000),  // débordera
    ]
    const corpus = buildTenderCorpus(pieces, 5_000)

    // Le BPU est intégralement présent : ses 200 caractères tiennent d'affilée.
    expect(corpus).toContain('x'.repeat(200))
    // Le CCTP est annoncé, présent, et signalé comme tronqué — jamais escamoté.
    expect(corpus).toContain('CCTP.pdf')
    expect(corpus).toContain('pièce tronquée')
    expect(corpus.length).toBeLessThanOrEqual(5_000)
  })

  it('annonce chaque pièce par son nom, pour que l’IA sache qui dit quoi', () => {
    const corpus = buildTenderCorpus([piece('CCTP-lot3.pdf', 'cctp', 50)])
    expect(corpus).toContain('=== Clauses techniques (CCTP) — CCTP-lot3.pdf ===')
  })

  it('ignore les pièces sans texte plutôt que de laisser croire qu’elles ont été lues', () => {
    const pieces: TenderPiece[] = [
      { filename: 'plan-scanne.pdf', kind: 'plan', text: '   ' },
      piece('CCTP.pdf', 'cctp', 50),
    ]
    const corpus = buildTenderCorpus(pieces)

    expect(corpus).not.toContain('plan-scanne.pdf')
    expect(corpus).toContain('CCTP.pdf')
  })

  it('rend une chaîne vide quand aucune pièce n’est lisible', () => {
    expect(buildTenderCorpus([])).toBe('')
    expect(buildTenderCorpus([{ filename: 'a.pdf', kind: null, text: '' }])).toBe('')
  })

  it('reste sous le budget même avec un dossier complet de 8 pièces', () => {
    const pieces = ['rc', 'ccap', 'cctp', 'dpgf', 'bpu', 'plan', 'annexe', 'autre'].map((k, i) =>
      piece(`piece-${i}.pdf`, k as TenderPiece['kind'], 40_000),
    )
    const corpus = buildTenderCorpus(pieces)

    expect(corpus.length).toBeLessThanOrEqual(TENDER_CORPUS_BUDGET)
    for (let i = 0; i < 8; i++) expect(corpus).toContain(`piece-${i}.pdf`)
  })
})
