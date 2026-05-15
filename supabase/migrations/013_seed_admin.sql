-- Seed admin initial — placeholder.
-- L'insertion réelle de l'utilisateur admin dans auth.users se fait via
-- scripts/bootstrap-admin.ts (Task 6), car la création d'un user Supabase Auth
-- nécessite l'API admin Auth (hash mdp, etc.) — pas faisable en SQL pur.
--
-- Cette migration documente l'intention et offre un raise notice.

do $$
declare
  admin_email text := current_setting('app.settings.initial_admin_email', true);
begin
  if admin_email is null or admin_email = '' then
    admin_email := 'admin@memoria.nc';
  end if;

  raise notice 'Initial admin email expected: %. Run: npm run db:bootstrap-admin', admin_email;
end $$;
