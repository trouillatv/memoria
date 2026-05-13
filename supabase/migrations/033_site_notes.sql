-- Migration 032 : Mémoire des lieux — Sprint 2 doctrine V5.
--
-- Notes courtes vivantes par site (140 chars max). PAS un wiki.
-- Format descriptif passif uniquement (verrou V4 : pas de formulations
-- de contrôle humain « Pense à... », « Attention à... »).
-- Édition contrainte (verrou V5 : pas de mini-CMS).

create table public.site_notes (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null,
  deleted_at  timestamptz,
  constraint chk_site_note_body_length
    check (char_length(body) >= 3 and char_length(body) <= 140)
);

create index idx_site_notes_site_active
  on public.site_notes(site_id, created_at desc)
  where deleted_at is null;

alter table public.site_notes enable row level security;

-- Tous les rôles authentifiés peuvent lire les notes (utile pour l'agent terrain).
drop policy if exists "authenticated read site_notes" on public.site_notes;
create policy "authenticated read site_notes"
  on public.site_notes
  for select
  using (auth.role() = 'authenticated');

-- Insert : authentifié peut ajouter, à condition que created_by = auth.uid().
-- Le check empêche de signer une note au nom d'un autre user.
drop policy if exists "authenticated insert site_notes" on public.site_notes;
create policy "authenticated insert site_notes"
  on public.site_notes
  for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

-- Soft-delete (UPDATE) : auteur OR admin/manager.
drop policy if exists "author or admin/manager soft-delete site_notes" on public.site_notes;
create policy "author or admin/manager soft-delete site_notes"
  on public.site_notes
  for update
  using (
    public.current_user_role() in ('admin', 'manager')
    or created_by = auth.uid()
  )
  with check (
    public.current_user_role() in ('admin', 'manager')
    or created_by = auth.uid()
  );

comment on table public.site_notes is
  'Doctrine V5 mémoire des lieux. Notes courtes vivantes par site (140 chars max). PAS un wiki. Format descriptif passif.';
comment on column public.site_notes.body is
  'Note courte 3-140 chars. Verrou V4 : pas de formulation de contrôle (« Pense à... »). Verrou V5 : édition contrainte.';
