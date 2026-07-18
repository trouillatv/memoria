import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Lot 4 · Slice 6A — socle DURABLE d'événements d'action ───────────────────
// Le comportement transactionnel (atomicité, no-op, append-only, invariant) a été
// prouvé en base (transaction annulée : created=1 assigned=1 due=1 completed=1
// reopened=1, doublons refusés, UPDATE/insert-hors-site refusés). Ici on VERROUILLE
// la structure de la migration et le routage des writers par lecture de source.

const mig = readFileSync(join(process.cwd(), 'supabase/migrations/221_site_action_events.sql'), 'utf8')

describe('migration 221 — journal append-only, atomique, prouvable', () => {
  it('six événements seulement — pas de status_changed générique', () => {
    expect(mig).toMatch(/kind\s+text not null check \(kind in \('created','assigned','unassigned','due_date_changed','completed','reopened'\)\)/)
    expect(mig).not.toContain('status_changed')
  })

  it('unicité durable de created par action (index unique partiel)', () => {
    expect(mig).toMatch(/create unique index[\s\S]*?on public\.site_action_events \(action_id\) where kind = 'created'/)
  })

  it('before/after en JSONB (identité structurelle + libellé snapshot)', () => {
    expect(mig).toMatch(/before_value jsonb/)
    expect(mig).toMatch(/after_value  jsonb/)
    expect(mig).toContain("jsonb_build_object('contact_id'")
  })

  it('acteur = public.users, actor_label snapshot conservé', () => {
    expect(mig).toMatch(/actor_id\s+uuid references public\.users\(id\)/)
    expect(mig).toContain('actor_label')
  })

  it('append-only : UPDATE refusé, DELETE direct refusé (cascade tolérée)', () => {
    expect(mig).toContain('append-only (mise à jour interdite)')
    expect(mig).toContain('append-only (suppression directe interdite)')
    // la cascade est tolérée : on ne refuse le DELETE que si l'action existe encore
    expect(mig).toMatch(/if exists \(select 1 from public\.site_actions where id = old\.action_id\)/)
  })

  it('invariant tenant/site garanti EN BASE (pas seulement en TS)', () => {
    expect(mig).toMatch(/create trigger trg_action_event_site before insert on public\.site_action_events/)
    expect(mig).toContain('hors du site')
  })

  it('mutation + événement dans la même fonction (atomiques), état verrouillé', () => {
    expect(mig).toMatch(/for update/)
    expect(mig).toContain('fn_update_action')
    expect(mig).toContain('fn_complete_action')
    expect(mig).toContain('fn_reopen_action')
  })

  it('un événement seulement si la valeur change vraiment', () => {
    expect(mig).toMatch(/is distinct from v\.assigned_contact_id/)
    expect(mig).toMatch(/is distinct from v\.due_date/)
  })

  it('backfill PROUVABLE : created seulement, depuis created_at/created_by', () => {
    expect(mig).toMatch(/insert into public\.site_action_events[\s\S]*?'created', a\.created_at, a\.created_by/)
    // aucun backfill spéculatif : seul `created` est adossé aux colonnes existantes
    // (un backfill d'attribution/échéance/clôture référencerait l'alias `a.`).
    expect(mig).not.toMatch(/'(assigned|unassigned|due_date_changed|completed|reopened)', a\./)
  })
})

describe('writers — toute mutation historisable passe par la RPC transactionnelle', () => {
  it('updateSiteAction route via fn_update_action (point de passage unique)', () => {
    const src = readFileSync(join(process.cwd(), 'lib/db/site-actions.ts'), 'utf8')
    expect(src).toContain("rpc('fn_update_action'")
    // patch partiel exact : on ne transmet que les clés fournies
    expect(src).toMatch(/if \(patch\.assigned_contact_id !== undefined\) p_patch\.assigned_contact_id/)
    // acteur facultatif, jamais inventé
    expect(src).toMatch(/actorId\?: string \| null/)
    expect(src).toContain('p_actor_id: actorId ?? null')
  })

  it('markSiteActionDone route via fn_complete_action', () => {
    const src = readFileSync(join(process.cwd(), 'lib/db/site-actions.ts'), 'utf8')
    expect(src).toContain("rpc('fn_complete_action'")
  })

  it('reopenActionAction route via fn_reopen_action (événement reopened dès 6A)', () => {
    const src = readFileSync(join(process.cwd(), 'app/(dashboard)/actions/actions.ts'), 'utf8')
    expect(src).toContain("rpc('fn_reopen_action'")
    // l'état courant peut repasser open/done_at=null : le journal conserve l'histoire
    expect(src).not.toMatch(/\.update\(\{ status: 'open', done_at: null \}\)/)
  })
})
