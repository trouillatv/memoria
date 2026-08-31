// P0 nettoyage nav — « Historique des propositions » (ex-« Tout ce que MemorIA a
// retenu ») recentrée sur l'ARCHIVE d'audit. Contrat verrouillé :
//   • les propositions ÉCARTÉES / REMPLACÉES restent retrouvables ici ;
//   • les propositions ACTIVES ne sont PLUS dupliquées (elles vivent dans
//     VisitDesk / le compte-rendu). Pas de seconde surface de travail.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FactLedgerView } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/memoire/FactLedgerView'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

function makeProposal(over: Partial<DbKnowledgeProposal> & { id: string; status: DbKnowledgeProposal['status'] }): DbKnowledgeProposal {
  return {
    organization_id: 'org', site_id: 's1', report_id: 'r1', analysis_version: 1,
    kind: 'action', title: 'T', body: null, payload: {} as DbKnowledgeProposal['payload'],
    confidence: null, source_capture_ids: [], dedupe_key: over.id, promoted_object_type: null,
    promoted_object_id: null, superseded_by: null, dismiss_reason: null, reviewed_at: null,
    reviewed_by: null, canonical_subject_id: null, canonical_resolution_status: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', ...over,
  }
}

describe('FactLedgerView — archive d\'audit (pas de duplication de l\'actif)', () => {
  const active = [makeProposal({ id: 'act', status: 'confirmed', title: 'Action active matérialisée' })]
  const archived = [
    makeProposal({ id: 'old', status: 'superseded', title: 'Ancienne proposition remplacée' }),
    makeProposal({ id: 'drop', status: 'dismissed', kind: 'knowledge', title: 'Proposition écartée', dismiss_reason: 'Doublon' }),
  ]

  it('les propositions remplacées / écartées restent retrouvables', () => {
    render(<FactLedgerView active={active} archived={archived} subjectLabels={{}} siteId="s1" />)
    expect(screen.getByText(/Anciennes propositions/)).toBeInTheDocument()
    expect(screen.getByText('Ancienne proposition remplacée')).toBeInTheDocument()
    expect(screen.getByText(/Écartés/)).toBeInTheDocument()
    expect(screen.getByText('Proposition écartée')).toBeInTheDocument()
  })

  it('les propositions actives NE sont PAS dupliquées ici (pas de « Mémoire active »)', () => {
    render(<FactLedgerView active={active} archived={archived} subjectLabels={{}} siteId="s1" />)
    expect(screen.queryByText(/Mémoire active/)).not.toBeInTheDocument()
    expect(screen.queryByText('Action active matérialisée')).not.toBeInTheDocument()
  })

  it('sans archive : message d\'archive vide (jamais une liste d\'actifs)', () => {
    render(<FactLedgerView active={active} archived={[]} subjectLabels={{}} siteId="s1" />)
    expect(screen.getByText(/Aucune proposition archivée/)).toBeInTheDocument()
    expect(screen.queryByText('Action active matérialisée')).not.toBeInTheDocument()
  })
})
