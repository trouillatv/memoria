# ⛔ Checklist BLOQUANTE — avant tout 2e tenant / vraie démo multi-tenant

> Tant que MemorIA est **mono-tenant** (un seul client en prod), ces points ne
> bloquent pas. Dès qu'un **2e client** ou une **démo multi-tenant** est en jeu,
> ils sont **OBLIGATOIRES**.

## 1. 🔴 Migration 114 — RLS org-scope des tables enfants d'interventions

**Statut : écrite, NON appliquée.** (`supabase/migrations/114_rls_org_scope_intervention_children.sql`)

Audit board 2026-06-17 — fuite cross-org confirmée : les policies RLS SELECT de
`intervention_photos / intervention_anomalies / intervention_checklist_items /
intervention_validations` étaient role-only (mig 038), sans `organization_id`.

- [ ] **Appliquer la migration 114** sur la base de prod.
- [ ] **Vérifier** (session authentifiée d'une org A) :
  ```sql
  select count(*) from intervention_photos where organization_id <> current_user_org_id();
  -- doit renvoyer 0
  ```

> L'app passe aujourd'hui par le service-role (bypass RLS) + scoping applicatif,
> donc pas de fuite active via l'UI ; mais c'est la **défense en profondeur** qui
> manque, et un seul oubli de filtre applicatif (nouvelle page / API / dev) ouvre
> la fuite. **RLS > code applicatif** pour un SaaS multi-tenant.
