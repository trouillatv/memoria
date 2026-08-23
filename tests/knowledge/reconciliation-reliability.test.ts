// RECONCILIATION-RELIABILITY P0 — contrat de non-régression.
//
// Invariant du lot :
//   Toute visite éligible finit soit canonicalisée, soit dans un état d'erreur
//   observable et rejouable. Jamais silencieusement entre les deux.
//
// Critère final : on peut tuer une réconciliation à n'importe quel moment et le
// système converge quand même automatiquement vers un état final observable.
//
// Ces tests protègent les trois pièces qui tiennent cet invariant :
//   1. le TTL du verrou, qui ne doit pas déclarer mort un run légitime ;
//   2. le seuil du sweep, qui ne doit jamais toucher un run encore vivant ;
//   3. le fait que le chemin terrain déclare son travail (after) au lieu de le
//      détacher, et que le cron rejoue par le MÊME point d'entrée.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  decideReconcileLock,
  RECONCILE_LOCK_TTL_MS,
} from '@/lib/db/canonical-subject-source-reconcile'
import { isSweepable, SWEEP_THRESHOLD_MS } from '@/lib/db/reconciliation-sweep'

const T0 = Date.parse('2026-08-24T10:00:00.000Z')
const ago = (ms: number) => new Date(T0 - ms).toISOString()
const MIN = 60_000

// ─── 1. TTL du verrou ────────────────────────────────────────────────────────
// L'audit a mesuré des réconciliations légitimes de 5 s à ~6 min. Avec le TTL
// initial de 5 min, un run VIVANT de 6 min était déclaré mort : le cron de
// reprise aurait démarré un second run par-dessus le premier (double dépense
// Gemini, concurrence sur les décisions de canonicalisation).

describe('RECONCILIATION-RELIABILITY — le TTL ne déclare pas mort un run vivant', () => {
  it('un run de 6 min (durée réelle maximale mesurée) est encore vu comme en cours', () => {
    expect(decideReconcileLock({ canonical_reconcile_started_at: ago(6 * MIN) }, T0)).toBe('concurrent')
  })

  it('le TTL garde une marge nette au-dessus de la durée réelle la plus longue', () => {
    // Régression visée : repasser le TTL sous ~6 min rouvrirait la fenêtre de
    // concurrence que ce lot ferme.
    expect(RECONCILE_LOCK_TTL_MS).toBeGreaterThanOrEqual(10 * MIN)
  })

  it('un verrou réellement abandonné reste repris (le TTL allongé ne gèle rien à vie)', () => {
    expect(decideReconcileLock({ canonical_reconcile_started_at: ago(RECONCILE_LOCK_TTL_MS + 1) }, T0)).toBe(
      'acquire',
    )
    // Le cas réel : verrous posés depuis 5,7 et 6,3 jours.
    expect(decideReconcileLock({ canonical_reconcile_started_at: ago(6 * 24 * 60 * MIN) }, T0)).toBe('acquire')
  })
})

// ─── 2. Seuil du sweep ───────────────────────────────────────────────────────

describe('RECONCILIATION-RELIABILITY — le sweep ne touche jamais un run vivant', () => {
  const stuck = (projectedAgoMs: number, reconciled: string | null = null) => ({
    debrief_projected_at: ago(projectedAgoMs),
    canonical_reconciled_at: reconciled,
  })

  it('le seuil du sweep reste au-dessus du TTL du verrou', () => {
    // Sinon le sweep rejouerait une visite dont le verrou est encore valide :
    // il ne ferait que collectionner des issues 'concurrent'.
    expect(SWEEP_THRESHOLD_MS).toBeGreaterThan(RECONCILE_LOCK_TTL_MS)
  })

  it('une visite projetée il y a 6 min (run le plus long mesuré) n’est PAS reprise', () => {
    expect(isSweepable(stuck(6 * MIN), T0)).toBe(false)
  })

  it('une visite projetée il y a 20 min (TTL dépassé, seuil non atteint) n’est PAS reprise', () => {
    expect(isSweepable(stuck(20 * MIN), T0)).toBe(false)
  })

  it('une visite projetée au-delà du seuil est reprise', () => {
    expect(isSweepable(stuck(SWEEP_THRESHOLD_MS), T0)).toBe(true)
    expect(isSweepable(stuck(6 * 24 * 60 * MIN), T0)).toBe(true) // les deux cas du 17/08
  })

  it('une visite déjà réconciliée n’est jamais reprise, quel que soit son âge', () => {
    expect(isSweepable(stuck(6 * 24 * 60 * MIN, '2026-08-18T10:00:00Z'), T0)).toBe(false)
  })

  it('une visite jamais projetée n’est pas du ressort du sweep', () => {
    expect(isSweepable({ debrief_projected_at: null, canonical_reconciled_at: null }, T0)).toBe(false)
  })
})

// ─── 3. Doctrine : chemins d'exécution ───────────────────────────────────────

describe('RECONCILIATION-RELIABILITY — doctrine des chemins d’exécution', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('le chemin terrain déclare son travail au runtime, il ne le détache pas', () => {
    const debrief = read('lib/visits/debrief-analysis.ts')
    expect(debrief).toMatch(/import \{ after \} from 'next\/server'/)
    expect(debrief).toMatch(/after\(task\)/)
    // Régression visée : le `void (async () => { … })()` d'origine, tué avec
    // l'instance serverless dès la réponse envoyée — sans erreur, sans trace.
    expect(debrief).not.toMatch(/void \(async \(\) => \{[\s\S]*decideReconcileLock/)
  })

  it('la réconciliation terrain a un point d’entrée unique, exporté et rejouable', () => {
    expect(read('lib/visits/debrief-analysis.ts')).toMatch(
      /export async function runCanonicalReconciliation\(/,
    )
  })

  it('le sweep rejoue par ce même point d’entrée, pas par une variante appauvrie', () => {
    const sweep = read('lib/db/reconciliation-sweep.ts')
    expect(sweep).toMatch(/runCanonicalReconciliation/)
    // Et le chemin import passe par le verrou PARTAGÉ, jamais un CAS recopié.
    expect(sweep).toMatch(/decideReconcileLock/)
    expect(sweep).toMatch(/acquireReconcileLock\(/)
    expect(sweep).toMatch(/canonical_reconcile_started_at: null/) // verrou relâché même en erreur
  })

  it('le cron rejoue, il ne se contente pas d’alerter', () => {
    const route = read('app/api/cron/sweep-stuck-reconciliation/route.ts')
    expect(route).toMatch(/replayReconciliation\(/)
    expect(route).toMatch(/Bearer \$\{process\.env\.CRON_SECRET\}/)
    expect(route).toMatch(/getReconciliationHealth\(/) // observabilité minimale
  })

  it('le cron est enregistré chez Vercel — un filet non déclenché n’est pas un filet', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    expect(vercel.crons.map((c) => c.path)).toContain('/api/cron/sweep-stuck-reconciliation')
  })

  it('aucune expression cron ne s’exécute plus d’une fois par jour — sinon le déploiement est refusé', () => {
    // Vécu le 2026-08-23 : `0 */6 * * *` a fait REFUSER la création du
    // déploiement (plan Hobby : « limited to daily cron jobs »). Le refus n'a
    // produit ni build, ni déploiement consultable — seulement un statut GitHub
    // rouge. Résultat : ce lot ET le commit suivant, déjà validé, sont restés
    // invisibles en production pendant près de 4 h sans que rien ne le signale.
    //
    // La cadence infra-journalière se compose donc par PLUSIEURS entrées
    // quotidiennes sur le même path, jamais par un pas dans l'expression.
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    for (const { path, schedule } of vercel.crons) {
      const [minute, hour] = schedule.split(' ')
      expect(minute, `${path} : minute « ${minute} » n'est pas fixe`).toMatch(/^\d{1,2}$/)
      expect(hour, `${path} : heure « ${hour} » n'est pas fixe`).toMatch(/^\d{1,2}$/)
    }
  })

  it('la cadence de reprise reste sous-journalière malgré la contrainte Hobby', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    const passes = vercel.crons.filter((c) => c.path === '/api/cron/sweep-stuck-reconciliation')
    // 1 replay par passage : c'est le NOMBRE de passages qui porte le débit.
    // Un seul passage quotidien ne reprendrait qu'une réconciliation par jour.
    expect(passes.length).toBeGreaterThanOrEqual(4)
    expect(new Set(passes.map((c) => c.schedule)).size).toBe(passes.length)
  })
})
