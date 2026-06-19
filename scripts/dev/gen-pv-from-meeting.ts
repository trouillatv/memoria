// Flux complet : réunion MemorIA (fixture) → détecte les trous → mappe en
// CrBecib (validé prime, trous = « à compléter ») → DOCX via template BECIB.
import * as fs from 'fs'
import { detectPvGaps, mapMeetingToCrBecib } from '@/lib/documents/meeting-to-cr-becib'
import { buildPvDocx } from '@/lib/documents/pv-docx-template'
import { MEETING_BECIB } from '@/lib/documents/fixtures/meeting-becib'

console.log('=== POINTS À CONFIRMER AVANT PV (filet qualité) ===')
detectPvGaps(MEETING_BECIB).forEach((q) => console.log(`  [${q.type}] ${q.question}${q.propositionIA ? `  → proposition: ${q.propositionIA}` : ''}`))

const cr = mapMeetingToCrBecib(MEETING_BECIB)
fs.writeFileSync('.preview/pv-from-meeting.docx', buildPvDocx(cr))
console.log('\n✓ .preview/pv-from-meeting.docx (chantier:', cr.meta.chantier + ', MOA:', cr.meta.moa + ')')
