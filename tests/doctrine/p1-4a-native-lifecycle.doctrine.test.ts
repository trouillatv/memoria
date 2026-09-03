import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P1-4A — cycle de vie NATIF : câblage des writers ─────────────────────────
//
// Invariants durables (mandat Vincent P1-4A) que les tests comportementaux
// (emitNativeActionLifecycleSignal) ne peuvent pas prouver au niveau des writers :
//   - Terminer explicitement émet une preuve COMPLETED de premier ordre.
//   - Rouvrir explicitement émet une preuve REOPENED.
//   - cancel ≠ DONE : le writer cancel NE DOIT JAMAIS émettre de signal de cycle de vie
//     (ni COMPLETED, ni quoi que ce soit), sous peine de transformer une annulation en
//     complétion silencieuse.

const SRC = readFileSync(join(process.cwd(), 'lib/db/site-actions.ts'), 'utf8')

/** Extrait le corps textuel d'une fonction exportée (jusqu'au prochain `export ` ou EOF). */
function bodyOf(fnName: string): string {
  const start = SRC.indexOf(`export async function ${fnName}`)
  if (start < 0) throw new Error(`writer introuvable : ${fnName}`)
  const rest = SRC.slice(start + 1)
  const nextExport = rest.indexOf('\nexport ')
  return nextExport < 0 ? rest : rest.slice(0, nextExport)
}

describe('P1-4A — writers du cycle de vie natif', () => {
  it('markSiteActionDone émet un signal COMPLETED natif', () => {
    const body = bodyOf('markSiteActionDone')
    expect(body).toMatch(/emitNativeActionLifecycleSignal\(/)
    expect(body).toMatch(/event:\s*['"]completed['"]/)
  })

  it('reopenSiteAction émet un signal REOPENED natif', () => {
    const body = bodyOf('reopenSiteAction')
    expect(body).toMatch(/fn_reopen_action/)
    expect(body).toMatch(/emitNativeActionLifecycleSignal\(/)
    expect(body).toMatch(/event:\s*['"]reopened['"]/)
  })

  it('cancelSiteAction n’émet JAMAIS de signal de cycle de vie (cancel ≠ DONE)', () => {
    const body = bodyOf('cancelSiteAction')
    expect(body).not.toMatch(/emitNativeActionLifecycleSignal/)
    expect(body).not.toMatch(/COMPLETED/)
    // le writer reste une simple bascule de statut
    expect(body).toMatch(/status:\s*['"]cancelled['"]/)
  })

  it('l’émission est best-effort : la clôture ne doit pas échouer si le signal échoue', () => {
    const body = bodyOf('markSiteActionDone')
    // l'appel d'émission est enveloppé dans un try/catch (n'annule pas la clôture committée)
    expect(body).toMatch(/try\s*\{[\s\S]*emitNativeActionLifecycleSignal[\s\S]*\}\s*catch/)
  })
})
