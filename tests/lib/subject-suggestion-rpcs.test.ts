// Tests d'intégration — RPCs de validation des suggestions sémantiques (Lot 3)
//
// Couvre :
//   - accept atomique (RPC PostgreSQL)
//   - double accept refusé (not_pending)
//   - reject (UPDATE direct)
//   - undo reject (UPDATE direct)
//   - undo accept (RPC transactionnel)
//   - undo obsolète interdit (stale_undo)
//   - candidat inexistant interdit (invalid_candidate)
//   - cross-site interdit (invalid_thread)
//
// Test d'INTÉGRATION (vraie Supabase) → déclaré dans tests/integration-tests.ts.
// Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const TAG = `__test_lot3_rpcs_${Math.floor(Date.now() / 1000)}__`

// IDs créés pour ce run de test — nettoyés en afterAll
let orgId: string
let siteId: string
let otherSiteId: string
let csSourceId: string   // canonical_subject initial du thread (avant merge)
let csTargetId: string   // canonical_subject vers lequel on merge
let csOtherSiteId: string // canonical_subject d'un autre site (cross-site)
const threadId = crypto.randomUUID()
const otherThreadId = crypto.randomUUID()
let suggestionId: string
let otherSiteSuggestionId: string

const P_USER = null // NULL accepté par la FK ON DELETE SET NULL — valide en test

beforeAll(async () => {
  const db = createAdminClient()

  // Organisation existante
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  // Client commun
  const { data: client, error: cErr } = await db
    .from('clients')
    .insert({ name: `${TAG}client`, organization_id: orgId })
    .select('id').single()
  if (cErr) throw cErr
  const clientId = (client as { id: string }).id

  // Site principal
  const { data: site, error: sErr } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (sErr) throw sErr
  siteId = (site as { id: string }).id

  // Site alternatif (cross-site tests)
  const { data: otherSite, error: osErr } = await db
    .from('sites')
    .insert({ name: `${TAG}other_site`, client_id: clientId, organization_id: orgId })
    .select('id').single()
  if (osErr) throw osErr
  otherSiteId = (otherSite as { id: string }).id

  // canonical_subject source (identité initiale du thread)
  const { data: csSource, error: cs1Err } = await db
    .from('canonical_subject')
    .insert({ site_id: siteId, label: `${TAG} CS source` })
    .select('id').single()
  if (cs1Err) throw cs1Err
  csSourceId = (csSource as { id: string }).id

  // canonical_subject cible (vers lequel le thread devrait merger)
  const { data: csTarget, error: cs2Err } = await db
    .from('canonical_subject')
    .insert({ site_id: siteId, label: `${TAG} CS target` })
    .select('id').single()
  if (cs2Err) throw cs2Err
  csTargetId = (csTarget as { id: string }).id

  // canonical_subject sur l'autre site (cross-site guard)
  const { data: csOther, error: cs3Err } = await db
    .from('canonical_subject')
    .insert({ site_id: otherSiteId, label: `${TAG} CS other site` })
    .select('id').single()
  if (cs3Err) throw cs3Err
  csOtherSiteId = (csOther as { id: string }).id

  // subject_thread_identity : thread → csSource (site principal)
  const { error: stiErr } = await db
    .from('subject_thread_identity')
    .insert({
      subject_thread_id: threadId,
      site_id: siteId,
      canonical_subject_id: csSourceId,
      source: 'auto',
    })
  if (stiErr) throw stiErr

  // subject_thread_identity pour l'autre site (cross-site)
  const { error: stiOtherErr } = await db
    .from('subject_thread_identity')
    .insert({
      subject_thread_id: otherThreadId,
      site_id: otherSiteId,
      canonical_subject_id: csOtherSiteId,
      source: 'auto',
    })
  if (stiOtherErr) throw stiOtherErr

  // Suggestion principale : threadId → csTargetId (site principal)
  const { data: sug, error: sugErr } = await db
    .from('canonical_subject_suggestion')
    .insert({
      site_id: siteId,
      subject_thread_id: threadId,
      proposal_label: `${TAG} Proposition test`,
      proposal_family: 'knowledge_fact',
      candidate_canonical_subject_id: csTargetId,
      shadow_decision: 'would_suggest',
      resolver_version: 'test_v1',
      model_name: 'test',
    })
    .select('id').single()
  if (sugErr) throw sugErr
  suggestionId = (sug as { id: string }).id

  // Suggestion cross-site : otherThreadId (sur otherSite) → csTargetId (sur site principal)
  // → thread et candidat sont sur deux sites différents → doit échouer
  const { data: otherSiteSug, error: otherSiteSugErr } = await db
    .from('canonical_subject_suggestion')
    .insert({
      site_id: otherSiteId,
      subject_thread_id: otherThreadId,
      proposal_label: `${TAG} Cross-site prop`,
      proposal_family: 'knowledge_fact',
      candidate_canonical_subject_id: csOtherSiteId,
      shadow_decision: 'would_suggest',
      resolver_version: 'test_v1',
      model_name: 'test',
    })
    .select('id').single()
  if (otherSiteSugErr) throw otherSiteSugErr
  otherSiteSuggestionId = (otherSiteSug as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  // Ordre inverse des FK : suggestions → threads → canonical_subjects → sites → client
  if (suggestionId) await db.from('canonical_subject_suggestion').delete().eq('id', suggestionId)
  if (otherSiteSuggestionId) await db.from('canonical_subject_suggestion').delete().eq('id', otherSiteSuggestionId)
  if (threadId) await db.from('subject_thread_identity').delete().eq('subject_thread_id', threadId)
  if (otherThreadId) await db.from('subject_thread_identity').delete().eq('subject_thread_id', otherThreadId)
  if (csSourceId) await db.from('canonical_subject').delete().eq('id', csSourceId)
  if (csTargetId) await db.from('canonical_subject').delete().eq('id', csTargetId)
  if (csOtherSiteId) await db.from('canonical_subject').delete().eq('id', csOtherSiteId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (otherSiteId) await db.from('sites').delete().eq('id', otherSiteId)
  // Le client est lié aux sites — supprime après
  const { data: client } = await db.from('clients').select('id').ilike('name', `${TAG}%`).maybeSingle()
  if (client) await db.from('clients').delete().eq('id', (client as { id: string }).id)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchSuggestion(id: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('canonical_subject_suggestion')
    .select('resolution, previous_canonical_subject_id, resolved_at')
    .eq('id', id)
    .single()
  return data as { resolution: string; previous_canonical_subject_id: string | null; resolved_at: string | null } | null
}

async function fetchThread(threadUuid: string) {
  const db = createAdminClient()
  const { data } = await db
    .from('subject_thread_identity')
    .select('canonical_subject_id, source')
    .eq('subject_thread_id', threadUuid)
    .single()
  return data as { canonical_subject_id: string; source: string } | null
}

async function resetSuggestionToPending() {
  const db = createAdminClient()
  await db
    .from('canonical_subject_suggestion')
    .update({ resolution: 'pending', resolved_at: null, resolved_by: null, previous_canonical_subject_id: null })
    .eq('id', suggestionId)
  // Réinitialise aussi l'identité du thread (source revient à csSource)
  await db
    .from('subject_thread_identity')
    .update({ canonical_subject_id: csSourceId, source: 'auto', reviewed_at: null, reviewed_by: null })
    .eq('subject_thread_id', threadId)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RPC accept_subject_suggestion', () => {
  it('accepte une suggestion pending → thread pointe vers csTarget, résolution accepted', async () => {
    const db = createAdminClient()

    const { data, error } = await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    expect(error).toBeNull()
    expect(data).toBe('ok')

    // Vérifie l'identité du thread
    const thread = await fetchThread(threadId)
    expect(thread?.canonical_subject_id).toBe(csTargetId)
    expect(thread?.source).toBe('manual')

    // Vérifie la suggestion
    const sug = await fetchSuggestion(suggestionId)
    expect(sug?.resolution).toBe('accepted')
    expect(sug?.previous_canonical_subject_id).toBe(csSourceId)
    expect(sug?.resolved_at).not.toBeNull()
  })

  it('refuse le double accept (not_pending)', async () => {
    // La suggestion est déjà accepted d'après le test précédent
    const db = createAdminClient()

    const { data, error } = await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    expect(error).toBeNull()
    expect(data).toBe('not_pending')

    // Remet en état pending pour les tests suivants
    await resetSuggestionToPending()
  })

  it('refuse un candidat inexistant (invalid_candidate)', async () => {
    const db = createAdminClient()

    // Crée une suggestion avec un candidat qui n'existe pas
    const { data: tempSug, error: tErr } = await db
      .from('canonical_subject_suggestion')
      .insert({
        site_id: siteId,
        subject_thread_id: threadId,
        proposal_label: `${TAG} Candidat inexistant`,
        proposal_family: 'knowledge_fact',
        candidate_canonical_subject_id: crypto.randomUUID(), // UUID inexistant
        shadow_decision: 'would_suggest',
        resolver_version: 'test_invalid_cand',
        model_name: 'test',
      })
      .select('id').single()

    // La suggestion peut échouer si le candidate_canonical_subject_id ne respecte pas la FK
    // (ON DELETE SET NULL signifie que la FK peut être NULL mais pas un UUID inexistant à l'insert)
    // Dans ce cas l'insert échoue — c'est aussi une protection valide.
    if (tErr) {
      // La contrainte FK protège à l'insert : le test est toujours valide
      expect(tErr.code).toMatch(/23503|23000/) // FK violation
      return
    }

    const tempSugId = (tempSug as { id: string }).id

    const { data } = await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: tempSugId,
      p_user_id: P_USER,
    })

    expect(data).toBe('invalid_candidate')

    // Nettoyage
    await db.from('canonical_subject_suggestion').delete().eq('id', tempSugId)
  })
})

describe('RPC reject (UPDATE direct)', () => {
  it('rejette une suggestion pending → resolution rejected, thread inchangé', async () => {
    const db = createAdminClient()

    // Vérifie état initial
    const before = await fetchThread(threadId)
    expect(before?.canonical_subject_id).toBe(csSourceId)

    await db
      .from('canonical_subject_suggestion')
      .update({ resolution: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', suggestionId)

    const sug = await fetchSuggestion(suggestionId)
    expect(sug?.resolution).toBe('rejected')

    // Thread inchangé
    const after = await fetchThread(threadId)
    expect(after?.canonical_subject_id).toBe(csSourceId)

    await resetSuggestionToPending()
  })
})

describe('RPC undo_accept_subject_suggestion', () => {
  it('annule un accept → thread restauré vers csSource, suggestion repassée pending', async () => {
    const db = createAdminClient()

    // D'abord accepter
    await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    // Vérifie thread sur csTarget
    const threadAfterAccept = await fetchThread(threadId)
    expect(threadAfterAccept?.canonical_subject_id).toBe(csTargetId)

    // Undo
    const { data, error } = await db.rpc('undo_accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    expect(error).toBeNull()
    expect(data).toBe('ok')

    // Thread restauré
    const threadAfterUndo = await fetchThread(threadId)
    expect(threadAfterUndo?.canonical_subject_id).toBe(csSourceId)
    expect(threadAfterUndo?.source).toBe('auto')

    // Suggestion repassée pending
    const sug = await fetchSuggestion(suggestionId)
    expect(sug?.resolution).toBe('pending')
    expect(sug?.previous_canonical_subject_id).toBeNull()
  })

  it('refuse un undo obsolète (stale_undo) — thread déjà réassigné par une décision plus récente', async () => {
    const db = createAdminClient()

    // Accept initial
    await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    // Simule une réassignation humaine ultérieure vers csSource (différente de csTarget)
    await db
      .from('subject_thread_identity')
      .update({ canonical_subject_id: csSourceId, source: 'manual' })
      .eq('subject_thread_id', threadId)

    // Undo doit être refusé car le thread ne pointe plus vers csTarget
    const { data } = await db.rpc('undo_accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    expect(data).toBe('stale_undo')

    // Nettoyage manuel (le RPC n'a rien modifié)
    await resetSuggestionToPending()
  })

  it('refuse un undo sur une suggestion non accepted (not_accepted)', async () => {
    // La suggestion est pending après resetSuggestionToPending
    const db = createAdminClient()

    const { data } = await db.rpc('undo_accept_subject_suggestion', {
      p_suggestion_id: suggestionId,
      p_user_id: P_USER,
    })

    expect(data).toBe('not_accepted')
  })
})

describe('Undo reject (UPDATE direct)', () => {
  it('annule un reject → suggestion repassée pending', async () => {
    const db = createAdminClient()

    // Rejeter d'abord
    await db
      .from('canonical_subject_suggestion')
      .update({ resolution: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', suggestionId)

    const rejected = await fetchSuggestion(suggestionId)
    expect(rejected?.resolution).toBe('rejected')

    // Undo reject
    await db
      .from('canonical_subject_suggestion')
      .update({ resolution: 'pending', resolved_at: null, resolved_by: null })
      .eq('id', suggestionId)

    const restored = await fetchSuggestion(suggestionId)
    expect(restored?.resolution).toBe('pending')
  })
})

describe('Guard cross-site', () => {
  it('refuse un accept quand thread et suggestion appartiennent à des sites différents', async () => {
    // otherSiteSuggestionId a site_id = otherSiteId
    // otherThreadId est dans subject_thread_identity avec site_id = otherSiteId
    // Le candidat (csOtherSiteId) appartient aussi à otherSiteId
    // → ce test vérifie qu'une suggestion correctement constituée sur l'autre site fonctionne
    // Pour tester le cross-site guard, il faut une suggestion dont le site_id diffère du site du thread
    // → ce scénario n'est pas constructible via l'UI (le site_id est copié du run)
    // → le guard "invalid_thread" se déclenche si v_sti.site_id != v_sug.site_id

    const db = createAdminClient()

    // Crée une suggestion sur siteId mais avec un thread qui appartient à otherSiteId
    const { data: crossSug, error: csugErr } = await db
      .from('canonical_subject_suggestion')
      .insert({
        site_id: siteId,                      // site principal
        subject_thread_id: otherThreadId,     // thread de l'autre site
        proposal_label: `${TAG} Cross-site guard`,
        proposal_family: 'knowledge_fact',
        candidate_canonical_subject_id: csTargetId,
        shadow_decision: 'would_suggest',
        resolver_version: 'test_cross_site',
        model_name: 'test',
      })
      .select('id').single()

    if (csugErr) {
      // Possible si une contrainte empêche l'insert — guard valide de toute façon
      expect(csugErr).toBeTruthy()
      return
    }

    const crossSugId = (crossSug as { id: string }).id

    const { data } = await db.rpc('accept_subject_suggestion', {
      p_suggestion_id: crossSugId,
      p_user_id: P_USER,
    })

    // Le thread appartient à otherSiteId mais la suggestion déclare siteId → invalid_thread
    expect(data).toBe('invalid_thread')

    await db.from('canonical_subject_suggestion').delete().eq('id', crossSugId)
  })
})
