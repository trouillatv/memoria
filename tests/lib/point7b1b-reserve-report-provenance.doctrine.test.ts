import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Point 7B-1b — provenance report_id des réserves. On propage report_id UNIQUEMENT
// quand l'appelant le connaît réellement (débrief/watchlist mobile) ; les réserves
// manuelles (réception MOE desktop) et copilote restent null. Aucun matching/fallback.

const reserve = readFileSync(join(process.cwd(), 'lib/db/site-reserve.ts'), 'utf8')
const debrief = readFileSync(join(process.cwd(), 'app/(field)/m/visite/[reportId]/debrief-actions.ts'), 'utf8')
const deskReserve = readFileSync(join(process.cwd(), 'app/(dashboard)/sites/[id]/reserves/actions.ts'), 'utf8')
const copilotReserve = readFileSync(join(process.cwd(), 'lib/db/site-reserve-write.ts'), 'utf8')

describe('7B-1b — createSiteReserve porte un report_id optionnel, jamais deviné', () => {
  it('signature : param reportId optionnel, inséré tel quel (null si absent)', () => {
    expect(reserve).toMatch(/reportId\?: string \| null/)
    expect(reserve).toMatch(/report_id: input\.reportId \?\? null/)
  })
})

describe('7B-1b — propagation seulement quand le report est réellement connu', () => {
  it('débrief mobile → réserve : report_id = report de la capture (c.report_id)', () => {
    expect(debrief).toMatch(/sourceCaptureId: capture_id, reportId: c\.report_id/)
  })
  it('promotion watchlist → réserve : report_id = report du point (item.report_id)', () => {
    expect(debrief).toMatch(/userId: auth\.userId, reportId: item\.report_id/)
  })
})

describe('7B-1b — création réellement manuelle / copilote : report_id reste null (aucune fabrication)', () => {
  it('réserve desktop (réception MOE) n’envoie PAS reportId', () => {
    // createReserveAction ne connaît aucun report source → ne passe jamais reportId
    expect(deskReserve).toMatch(/createSiteReserve\(\{[\s\S]*?\}\)/)
    expect(deskReserve).not.toContain('reportId')
  })
  it('confirmSiteReserve (copilote) n’envoie PAS reportId', () => {
    expect(copilotReserve).not.toContain('reportId')
  })
})
