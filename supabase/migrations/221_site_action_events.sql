-- =============================================================================
-- 221 — JOURNAL D'ÉVÉNEMENTS d'une action (Lot 4 · Slice 6A). Source de vérité
-- DURABLE des mutations : création, (dés)attribution, changement d'échéance,
-- clôture, réouverture. Append-only. L'événement et la mutation sont écrits
-- ATOMIQUEMENT (fonctions SQL transactionnelles), jamais deux requêtes séparées.
--
-- Garde-fous (arbitrage Vincent 2026-07-19) :
--   · before/after en JSONB (garde l'identité structurelle + un libellé snapshot) ;
--   · actor_id -> public.users (la vraie table applicative) + actor_label snapshot ;
--   · un événement UNIQUEMENT si la valeur métier change réellement ;
--   · unicité durable de `created` par action (index unique partiel) ;
--   · invariant tenant/site garanti EN BASE (pas seulement en TS) ;
--   · append-only protégé contre UPDATE et DELETE applicatif (cascade tolérée) ;
--   · backfill PROUVABLE de `created` seulement (created_at/created_by).
-- =============================================================================

create table if not exists public.site_action_events (
  id           uuid primary key default gen_random_uuid(),
  action_id    uuid not null references public.site_actions(id) on delete cascade,
  site_id      uuid not null references public.sites(id) on delete cascade,
  kind         text not null check (kind in ('created','assigned','unassigned','due_date_changed','completed','reopened')),
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references public.users(id) on delete set null,
  actor_label  text,           -- instantané lisible ; actor_id reste la relation
  before_value jsonb,
  after_value  jsonb,
  reason       text,
  created_at   timestamptz not null default now()
);

-- Un seul `created` par action, même si la migration est rejouée ou en cas de bug.
create unique index if not exists uq_action_event_created
  on public.site_action_events (action_id) where kind = 'created';
-- Tri déterministe.
create index if not exists idx_action_events_action
  on public.site_action_events (action_id, occurred_at, id);
create index if not exists idx_action_events_site on public.site_action_events (site_id);

-- Lecture org-scopée (les écritures passent par le service-role + fonctions).
alter table public.site_action_events enable row level security;
drop policy if exists "site_action_events read" on public.site_action_events;
create policy "site_action_events read" on public.site_action_events
  for select using (
    site_id in (select id from public.sites where organization_id = public.current_user_org_id())
  );

-- ── Invariant tenant/site : action_id doit appartenir à site_id ──────────────
create or replace function public.check_action_event_site()
returns trigger language plpgsql set search_path = '' as $$
declare v_site uuid;
begin
  select site_id into v_site from public.site_actions where id = new.action_id;
  if v_site is null or v_site is distinct from new.site_id then
    raise exception 'site_action_events: action (%) hors du site (%)', new.action_id, new.site_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_action_event_site on public.site_action_events;
create trigger trg_action_event_site before insert on public.site_action_events
  for each row execute function public.check_action_event_site();

-- ── Append-only : jamais d'UPDATE ; DELETE seulement via cascade ─────────────
-- (une suppression directe = l'action parente existe encore ; une cascade = elle
--  a déjà disparu dans la même transaction. On refuse la première, on tolère la
--  seconde. Un writer ne peut donc jamais corriger silencieusement le passé.)
create or replace function public.check_action_event_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'site_action_events est append-only (mise à jour interdite)';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.site_actions where id = old.action_id) then
      raise exception 'site_action_events est append-only (suppression directe interdite)';
    end if;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists trg_action_event_immutable on public.site_action_events;
create trigger trg_action_event_immutable before update or delete on public.site_action_events
  for each row execute function public.check_action_event_immutable();

-- ── `created` : trigger AFTER INSERT (l'acteur = created_by, la colonne) ─────
create or replace function public.fn_action_created_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.site_action_events(action_id, site_id, kind, occurred_at, actor_id, actor_label)
  values (new.id, new.site_id, 'created', new.created_at, new.created_by,
          (select full_name from public.users where id = new.created_by))
  on conflict (action_id) where kind = 'created' do nothing;
  return new;
end $$;
drop trigger if exists trg_action_created on public.site_actions;
create trigger trg_action_created after insert on public.site_actions
  for each row execute function public.fn_action_created_event();

-- ── Mutation + événement ATOMIQUES : update partiel + assigned/due ───────────
-- Sémantique EXACTE du patch partiel : clé absente = inchangée ; clé présente
-- (même null) = affecte. Événement émis SEULEMENT si la valeur change réellement.
create or replace function public.fn_update_action(p_id uuid, p_patch jsonb, p_actor_id uuid default null)
returns uuid language plpgsql set search_path = '' as $$
declare
  v public.site_actions;
  v_label text;
  v_new_contact uuid;
  v_new_due date;
  v_new_due_status text;
begin
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  v_label := (select full_name from public.users where id = p_actor_id);

  update public.site_actions set
    title               = case when p_patch ? 'title'               then (p_patch->>'title')                    else title end,
    body                = case when p_patch ? 'body'                then (p_patch->>'body')                     else body end,
    assigned_to         = case when p_patch ? 'assigned_to'         then (p_patch->>'assigned_to')              else assigned_to end,
    assigned_contact_id = case when p_patch ? 'assigned_contact_id' then (p_patch->>'assigned_contact_id')::uuid else assigned_contact_id end,
    corps_etat          = case when p_patch ? 'corps_etat'          then (p_patch->>'corps_etat')               else corps_etat end,
    due_date            = case when p_patch ? 'due_date'            then (p_patch->>'due_date')::date           else due_date end,
    due_date_status     = case when p_patch ? 'due_date_status'     then (p_patch->>'due_date_status')          else due_date_status end,
    status              = case when p_patch ? 'status'              then (p_patch->>'status')                   else status end,
    kind                = case when p_patch ? 'kind'                then (p_patch->>'kind')                     else kind end
  where id = p_id;

  -- Attribution : seulement si assigned_contact_id change vraiment.
  if p_patch ? 'assigned_contact_id' then
    v_new_contact := (p_patch->>'assigned_contact_id')::uuid;
    if v_new_contact is distinct from v.assigned_contact_id then
      if v_new_contact is not null then
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, after_value)
        values (p_id, v.site_id, 'assigned', p_actor_id, v_label,
                jsonb_build_object('contact_id', v_new_contact,
                                   'label', (select full_name from public.company_contacts where id = v_new_contact)));
      else
        insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value)
        values (p_id, v.site_id, 'unassigned', p_actor_id, v_label,
                jsonb_build_object('contact_id', v.assigned_contact_id,
                                   'label', (select full_name from public.company_contacts where id = v.assigned_contact_id)));
      end if;
    end if;
  end if;

  -- Échéance : seulement si due_date change vraiment.
  if p_patch ? 'due_date' then
    v_new_due := (p_patch->>'due_date')::date;
    if v_new_due is distinct from v.due_date then
      v_new_due_status := case when p_patch ? 'due_date_status' then (p_patch->>'due_date_status') else v.due_date_status end;
      insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, before_value, after_value)
      values (p_id, v.site_id, 'due_date_changed', p_actor_id, v_label,
              jsonb_build_object('date', v.due_date, 'status', v.due_date_status),
              jsonb_build_object('date', v_new_due, 'status', v_new_due_status));
    end if;
  end if;

  return v.site_id;
end $$;

-- ── Clôture ATOMIQUE (no-op si déjà terminée : jamais un 2ᵉ completed) ───────
create or replace function public.fn_complete_action(p_id uuid, p_actor_id uuid default null, p_comment text default null, p_photo text default null)
returns uuid language plpgsql set search_path = '' as $$
declare v public.site_actions; v_label text;
begin
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  if v.status = 'done' then return v.site_id; end if;
  v_label := (select full_name from public.users where id = p_actor_id);
  update public.site_actions set status='done', done_at=now(), completed_comment=p_comment, completed_photo_path=p_photo where id=p_id;
  insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, after_value)
  values (p_id, v.site_id, 'completed', p_actor_id, v_label,
          case when p_comment is not null then jsonb_build_object('comment', p_comment) else null end);
  return v.site_id;
end $$;

-- ── Réouverture ATOMIQUE (no-op si pas terminée). L'état courant repasse open/
--    done_at=null ; l'événement `completed` du journal CONSERVE désormais l'histoire.
create or replace function public.fn_reopen_action(p_id uuid, p_actor_id uuid default null, p_reason text default null)
returns uuid language plpgsql set search_path = '' as $$
declare v public.site_actions; v_label text;
begin
  select * into v from public.site_actions where id = p_id for update;
  if not found then return null; end if;
  if v.status <> 'done' then return v.site_id; end if;
  v_label := (select full_name from public.users where id = p_actor_id);
  update public.site_actions set status='open', done_at=null where id=p_id;
  insert into public.site_action_events(action_id, site_id, kind, actor_id, actor_label, reason)
  values (p_id, v.site_id, 'reopened', p_actor_id, v_label, p_reason);
  return v.site_id;
end $$;

-- ── Backfill PROUVABLE : `created` seulement, depuis created_at/created_by ────
insert into public.site_action_events (action_id, site_id, kind, occurred_at, actor_id, actor_label)
select a.id, a.site_id, 'created', a.created_at, a.created_by, u.full_name
from public.site_actions a
left join public.users u on u.id = a.created_by
on conflict (action_id) where kind = 'created' do nothing;
