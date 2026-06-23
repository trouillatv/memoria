-- 159 — Socle « Notifications utilisateur » (Vincent 2026-06-23)
--
-- UN mécanisme générique pour surfacer une information à un utilisateur au
-- chargement (bandeau), plutôt qu'une inbox spécialisée par feature.
--
-- DOCTRINE (anti usine à notifications, cf. [[discipline-dapparition]],
-- [[risque-deux-morts-opposees]]) : ce n'est PAS « tout événement -> notif ».
-- Chaque TYPE doit passer le test des 4 questions (incertitude levée / erreur si
-- absent / action concrète / rareté). Aujourd'hui : un seul type, 'feedback_reply'.
--
-- Coexiste avec « Nouveau depuis hier » (user_feed_state, mig 157) — migration
-- vers ce socle plus tard, incrémentale. Pas de big-bang.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  type        text not null,                       -- 'feedback_reply' | (futurs, gated)
  title       text not null check (length(title) between 1 and 200),
  body        text check (body is null or length(body) <= 2000),
  link        text,                                 -- route interne facultative
  dedupe_key  text,                                 -- ex 'feedback_reply:<id>' (1 notif/clé)
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read_at, created_at desc);

create unique index if not exists notifications_dedupe_idx
  on public.notifications(user_id, dedupe_key) where dedupe_key is not null;

alter table public.notifications enable row level security;

-- Lecture/maj : le PROPRIÉTAIRE uniquement. Insert : service-role (Server Actions).
create policy "owner reads own notifications"
  on public.notifications for select using (auth.uid() = user_id);
create policy "owner updates own notifications"
  on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.notifications is
  'Socle notifications utilisateur (Vincent 2026-06-23). 1 type seulement pour l''instant (feedback_reply) ; tout nouveau type passe la discipline d''apparition. RLS : owner read/update ; insert service-role.';
