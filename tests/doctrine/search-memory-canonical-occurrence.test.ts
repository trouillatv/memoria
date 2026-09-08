// 🔎 MIG 398 — LA PREUVE CANONIQUE ENTRE DANS LA RECHERCHE, SANS RIEN CASSER.
//
// Audit MEMORY-SEARCH TRUTH (verdict PARTIAL_TRUTH_GAP) : une occurrence
// canonique (canonical_subject_occurrence) peut exister sans AUCUN équivalent
// legacy indexé — elle était donc invisible à `search_memory`, quel que soit
// le terme cherché. Cette migration ajoute une 19e CTE sans toucher aux 18
// existantes.
//
// FIX_REQUIRED post-review (checkpoint 6e3c83a0) : la dédup applicative de
// memory-search.ts n'opère que sur `id`, jamais sémantiquement — une
// canonical_subject_occurrence et son équivalent legacy ne sont donc PAS
// dédupliqués. Or >98 % des occurrences historical_pdf sont déjà représentées
// dans le corpus legacy. Périmètre resserré à field_visit SEUL : c'est le
// canal neuf réellement non garanti par le legacy, celui qui crée le trou de
// vérité. historical_pdf/meeting/copilot restent hors index de cette CTE.
//
// La migration n'est PAS appliquée à la base à l'écriture de ce test (gate de
// revue avant écriture) : on ne peut donc pas encore prouver le comportement
// contre une vraie exécution SQL. Ce fichier suit le précédent
// `tests/doctrine/search-litige-exclusion.test.ts` — un TRIPWIRE qui lit le
// texte de la migration et vérifie structurellement les garanties exigées :
//
//   1. field_visit → trouvable, ET SEUL (historical_pdf/meeting/copilot
//      explicitement exclus du filtre source_kind) ;
//   2. les 18 CTE legacy sont copiées BYTE FOR BYTE depuis la migration 387 →
//      aucune régression, aucune explosion de doublons (rien n'y change) ;
//   3. isolation org/site : les trois mêmes gardes p_contract_id/p_site_id/
//      p_org_id que toutes les autres CTE ;
//   4. un terme absent ne peut pas remonter : le filtre est un `@@` sur
//      `plainto_tsquery`, pas un `ilike '%…%'` ou un fallback permissif ;
//   5. les CTE existantes restent inchangées ET le UNION ALL final les
//      inclut toutes, dans le même ordre, en ajoutant la nouvelle en dernier.
//
// (La preuve fonctionnelle contre la vraie base viendra une fois la migration
// appliquée — hors périmètre de ce lot, cf. mandat.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(__dirname, '..', '..', 'supabase', 'migrations')
const SQL_398 = readFileSync(join(RACINE, '398_search_memory_canonical_occurrence.sql'), 'utf-8')
const SQL_387 = readFileSync(join(RACINE, '387_search_memory_action_events.sql'), 'utf-8')

function extraire(sql: string, finMarqueur: string): string {
  const debut = sql.indexOf('with query as (')
  const fin = sql.indexOf(finMarqueur, debut)
  if (debut === -1 || fin === -1) throw new Error('marqueurs introuvables — la structure a changé')
  return sql.slice(debut, fin)
}

describe('🔎 Mig 398 — la preuve canonique entre dans la recherche', () => {
  it('la nouvelle CTE existe et porte le bon nom', () => {
    expect(SQL_398).toMatch(/,canonical_occurrence_hits as \(/)
  })

  it('GARANTIE 1 — field_visit fait partie du périmètre indexé (sans lui, le trou du mandat n’est pas fermé)', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).not.toBe('')
    expect(cte).toMatch(/co\.source_kind = 'field_visit'/)
  })

  it('GARANTIE 1B — historical_pdf/meeting/copilot sont explicitement EXCLUS de cette CTE (dédup applicative par id seul, insuffisante contre la redondance legacy mesurée >98 %)', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).not.toBe('')
    expect(cte).not.toMatch(/'historical_pdf'/)
    expect(cte).not.toMatch(/'meeting'/)
    expect(cte).not.toMatch(/'copilot'/)
    // pas de forme `in (...)` avec plusieurs valeurs : un seul source_kind, une égalité stricte
    expect(cte).not.toMatch(/co\.source_kind in \(/)
  })

  it('GARANTIE 2 — les 18 CTE existantes sont BYTE FOR BYTE identiques à la migration 387 (aucune régression legacy possible)', () => {
    // Coupé juste avant le premier `select * from anom_hits` en 387, et juste
    // avant le commentaire d'en-tête de la mig 398 en 398 — le même point
    // structurel : la fermeture de la 18e CTE (action_event_hits).
    const bloc387 = extraire(SQL_387, '\n  select * from anom_hits')
    const bloc398 = extraire(SQL_398, '\n  -- ── MIG 398')
    expect(bloc398).toBe(bloc387)
  })

  it('GARANTIE 3 — isolation org/site/contrat : les trois mêmes gardes que toutes les autres CTE', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).toMatch(/p_contract_id is null or s\.contract_id = p_contract_id/)
    expect(cte).toMatch(/p_site_id is null or co\.site_id = p_site_id/)
    expect(cte).toMatch(/p_org_id is null or s\.organization_id = p_org_id/)
  })

  it('GARANTIE 4 — le filtre texte est un `@@` sur tsquery, jamais un ILIKE permissif : un terme absent ne remonte jamais', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).toMatch(/@@ q\.tsq/)
    expect(cte).not.toMatch(/ilike/i)
  })

  it('GARANTIE 5 — le UNION ALL final inclut les 18 CTE existantes dans le même ordre, puis la nouvelle en dernier', () => {
    const unionAttendu = [
      'anom_hits', 'notes_hits', 'intv_hits', 'photo_hits', 'action_hits',
      'decision_hits', 'reserve_hits', 'pv_hits', 'observation_hits',
      'site_decision_hits', 'knowledge_hits', 'blocage_hits', 'obligation_hits',
      'subject_hits', 'document_hits', 'meeting_hits', 'intervenant_hits',
      'action_event_hits', 'canonical_occurrence_hits',
    ]
    const bloc = SQL_398.slice(SQL_398.indexOf('select * from anom_hits'), SQL_398.indexOf('order by rank desc'))
    const ordreReel = [...bloc.matchAll(/from (\w+)/g)].map((m) => m[1])
    expect(ordreReel).toEqual(unionAttendu)
  })

  it('aucun anti-join contre les CTE legacy — la déduplication reste celle de memory-search.ts, pas une exclusion SQL', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).not.toMatch(/not in \(select/i)
    expect(cte).not.toMatch(/not exists/i)
  })

  it('subject_id reste NULL — canonical_subject_id n’est jamais recopié dans une colonne qui désigne subjects.id (legacy) ailleurs dans la RPC', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).toMatch(/null::uuid as subject_id/)
  })

  it('ref_id porte source_ref_id — c’est lui qui ouvre la fiche de compte-rendu existante, jamais une adresse inventée', () => {
    const cte = /canonical_occurrence_hits as \([\s\S]*?\n  \)/.exec(SQL_398)?.[0] ?? ''
    expect(cte).toMatch(/co\.source_ref_id as ref_id/)
  })

  it('la signature de la fonction est inchangée — aucun appelant TypeScript n’a besoin d’être touché pour l’appel RPC lui-même', () => {
    expect(SQL_398).toMatch(
      /create function public\.search_memory\(\s*p_q text,\s*p_contract_id uuid default null,\s*p_site_id uuid default null,\s*p_period_days int default 365,\s*p_limit int default 50,\s*p_org_id uuid default null\s*\)/,
    )
  })
})
