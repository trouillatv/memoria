-- =============================================================================
-- 125 — DÉCISIONS HUMAINES sur les signaux de validation PV.
--
-- L'écran « points à confirmer » propose 4 verbes. `Compléter` corrige la MÉMOIRE
-- (resolver → objet source) et ne laisse aucune trace ici. Les 3 autres ne
-- touchent PAS la mémoire mais doivent être AUDITABLES :
--   reported        — « je ne sais pas encore » (différé, reste à traiter)
--   ignored         — « on s'en fiche pour ce chantier » (renoncement assumé)
--   false_positive  — « le détecteur s'est trompé » (retour vers la détection)
--
-- Clé = (report_id, signal_id) : une décision COURANTE par signal (upsert). Le
-- signal_id est l'id stable calculé par le détecteur (type + cible/libellé).
-- =============================================================================

create table if not exists public.pv_signal_decisions (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.site_reports(id) on delete cascade,
  signal_id   text not null,
  statut      text not null check (statut in ('reported', 'ignored', 'false_positive')),
  comment     text,
  decided_by  uuid references public.users(id) on delete set null,
  decided_at  timestamptz not null default now(),
  unique (report_id, signal_id)
);

create index if not exists idx_pv_signal_decisions_report on public.pv_signal_decisions(report_id);

-- RLS : lecture scopée org via le site de la réunion (défense en profondeur ;
-- les écritures et la lecture applicative passent par le service-role, server
-- actions gardées admin/manager).
alter table public.pv_signal_decisions enable row level security;
drop policy if exists "pv_signal_decisions read" on public.pv_signal_decisions;
create policy "pv_signal_decisions read" on public.pv_signal_decisions
  for select using (
    report_id in (
      select sr.id from public.site_reports sr
      join public.sites s on s.id = sr.site_id
      where s.organization_id = public.current_user_org_id()
    )
  );
