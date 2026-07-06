-- 186 — Intentions de visite (un seul moteur de visite, spécialisé par l'INTENTION).
--
-- Une prévisite AO / première visite / réception… sont TOUTES des visites : même
-- moteur de capture. Seule l'intention change (libellés, CR, questions de fin,
-- mémoire, actions proposées). On étend donc `visit_motive` avec les intentions
-- métier, au lieu d'ajouter un bouton (ou un objet) par métier.
--
-- Nouvelles valeurs : premiere · previsite_ao · prereception · sav.
-- On conserve toutes les valeurs existantes (rétrocompatibilité).

do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.site_reports'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%visit_motive%';
  if c is not null then
    execute format('alter table public.site_reports drop constraint %I', c);
  end if;
end $$;

alter table public.site_reports
  add constraint site_reports_visit_motive_check
  check (visit_motive is null or visit_motive in (
    -- valeurs historiques (mig 162)
    'inspection', 'controle', 'reunion', 'avancement', 'reception',
    'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre',
    -- intentions métier (mig 186)
    'premiere', 'previsite_ao', 'prereception', 'sav'
  ));
