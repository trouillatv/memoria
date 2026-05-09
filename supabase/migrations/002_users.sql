-- Extension de auth.users avec rôle métier et statut MdP

create table public.users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  role                 user_role not null default 'chef_equipe',
  must_change_password boolean default false,
  created_at           timestamptz default now(),
  deleted_at           timestamptz
);

create index users_role_idx on public.users(role) where deleted_at is null;
