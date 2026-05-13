-- Migration 042 — Audit trail atomique des accès aux tokens de partage.
--
-- Phase 1.3 du plan « mémoire défendable ». L'incrément actuel d'access_count
-- est read-then-write non atomique : un accès simultané peut perdre des unités.
-- Pour la valeur juridique du dossier, on a besoin d'une trace immuable de
-- chaque accès, pas d'un compteur approximatif.
--
-- On garde access_count / last_accessed_at sur proof_share_tokens pour
-- l'affichage rapide (vue manager), MAIS on ajoute une table immuable
-- share_access_log qui sert de source de vérité juridique.

-- Table append-only des accès.
create table if not exists public.share_access_log (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.proof_share_tokens(id) on delete cascade,
  accessed_at timestamptz not null default now(),
  kind text not null check (kind in ('viewed', 'downloaded')),
  -- Contexte facultatif (IP / user-agent) pour traçabilité forensique.
  ip_address inet,
  user_agent text
);

create index if not exists share_access_log_token_idx
  on public.share_access_log(token_id, accessed_at desc);

-- RLS : admin/manager peuvent lire les logs de leurs tokens.
-- Pas d'insert/update/delete directs — passe par la RPC.
alter table public.share_access_log enable row level security;

drop policy if exists "share_access_log read for managers" on public.share_access_log;
create policy "share_access_log read for managers" on public.share_access_log
  for select using (public.current_user_role() in ('admin', 'manager'));

-- Trigger append-only : empêche tout UPDATE/DELETE même par service_role direct.
-- (Le service_role peut bypasser via la RPC SECURITY DEFINER si vraiment nécessaire.)
create or replace function public.share_access_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'share_access_log est append-only — UPDATE/DELETE interdits';
end;
$$;

drop trigger if exists share_access_log_no_update on public.share_access_log;
create trigger share_access_log_no_update
  before update on public.share_access_log
  for each row execute function public.share_access_log_append_only();

drop trigger if exists share_access_log_no_delete on public.share_access_log;
create trigger share_access_log_no_delete
  before delete on public.share_access_log
  for each row execute function public.share_access_log_append_only();

-- RPC atomique : INSERT dans share_access_log + UPDATE atomique du compteur
-- sur proof_share_tokens, dans une seule transaction.
create or replace function public.record_share_access(
  p_token_id uuid,
  p_kind text,
  p_ip inet default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('viewed', 'downloaded') then
    raise exception 'kind doit être viewed ou downloaded (reçu : %)', p_kind;
  end if;

  -- Append immuable.
  insert into public.share_access_log (token_id, kind, ip_address, user_agent)
  values (p_token_id, p_kind, p_ip, p_user_agent);

  -- Incrément atomique du compteur (pas de read-then-write).
  update public.proof_share_tokens
  set access_count = access_count + 1,
      last_accessed_at = now()
  where id = p_token_id;
end;
$$;

grant execute on function public.record_share_access(uuid, text, inet, text) to authenticated;
grant execute on function public.record_share_access(uuid, text, inet, text) to anon;
grant execute on function public.record_share_access(uuid, text, inet, text) to service_role;
