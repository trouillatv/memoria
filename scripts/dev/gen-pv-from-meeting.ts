// Flux complet : réunion MemorIA (fixture) → détecte les trous → mappe en
// CrBecib (validé prime, trous = « à compléter ») → DOCX via template BECIB.
import * as fs from 'fs'
import { detectPvGaps, mapMeetingToCrBecib } from '@/lib/documents/meeting-to-cr-becib'
import { buildPvDocx } from '@/lib/documents/pv-docx-template'
import { MEETING_BECIB } from '@/lib/documents/fixtures/meeting-becib'

console.log('=== POINTS À CONFIRMER AVANT PV (filet qualité) ===')
const EMOJI = { bloquant: '🔴', important: '🟠', suggestion: '🟢' } as const
detectPvGaps(MEETING_BECIB).forEach((p) => console.log(`  ${EMOJI[p.niveau]} [${p.type}] ${p.libelle}${p.proposition ? `  → proposition: ${p.proposition}` : ''}`))

const cr = mapMeetingToCrBecib(MEETING_BECIB)
fs.writeFileSync('.preview/pv-from-meeting.docx', buildPvDocx(cr))
console.log('\n✓ .preview/pv-from-meeting.docx (chantier:', cr.meta.chantier + ', MOA:', cr.meta.moa + ')')
