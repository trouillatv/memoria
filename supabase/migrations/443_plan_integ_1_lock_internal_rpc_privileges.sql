-- PLAN-INTEG-1 security micro-fix
-- Les RPC transactionnelles ci-dessous sont des primitives internes appelees
-- par les Server Actions apres gardes M2C. Elles ne doivent jamais etre
-- executables directement par les clients Supabase anon/authenticated.

revoke execute on function public.fn_plan_regenerate_cycle_templates(uuid, uuid) from public;
revoke execute on function public.fn_plan_regenerate_cycle_templates(uuid, uuid) from anon;
revoke execute on function public.fn_plan_regenerate_cycle_templates(uuid, uuid) from authenticated;
grant execute on function public.fn_plan_regenerate_cycle_templates(uuid, uuid) to service_role;

revoke execute on function public.fn_plan_publish_cycle_exclusive(uuid, boolean, uuid) from public;
revoke execute on function public.fn_plan_publish_cycle_exclusive(uuid, boolean, uuid) from anon;
revoke execute on function public.fn_plan_publish_cycle_exclusive(uuid, boolean, uuid) from authenticated;
grant execute on function public.fn_plan_publish_cycle_exclusive(uuid, boolean, uuid) to service_role;

revoke execute on function public.fn_plan_create_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from public;
revoke execute on function public.fn_plan_create_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from anon;
revoke execute on function public.fn_plan_create_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from authenticated;
grant execute on function public.fn_plan_create_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) to service_role;

revoke execute on function public.fn_plan_update_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from public;
revoke execute on function public.fn_plan_update_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from anon;
revoke execute on function public.fn_plan_update_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) from authenticated;
grant execute on function public.fn_plan_update_simple_template_exclusive(
  uuid,
  text,
  text,
  text[],
  smallint,
  smallint,
  text,
  text,
  date,
  date,
  uuid,
  boolean
) to service_role;
