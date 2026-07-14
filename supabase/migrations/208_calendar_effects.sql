-- Migration 208 — LE CALENDRIER DIT QUAND ; LE CHANTIER DIT QUEL EFFET.
--
-- Correction de modèle (Vincent, 2026-07-15). La mig 203/207 câblait « suit le
-- calendrier » = « fermé ». C'est faux, et l'école le prouve :
--
--   • une école ne doit PAS être nettoyée pendant les vacances → FERMÉ ;
--   • une autre fait justement son GRAND NETTOYAGE pendant les vacances
--     → travail prévu, aucun conflit ;
--   • un magasin n'est pas concerné → aucune incidence.
--
-- Les vacances scolaires sont un FAIT DE CALENDRIER. Leur effet est une RÈGLE
-- DE CHANTIER :
--
--   'none'    non concerné       → aucune conséquence ;
--   'closed'  fermé              → SEUL ce mode produit des site_closures ;
--   'works'   travail prévu      → aucune fermeture, aucun conflit — le
--             travail pendant la période est NORMAL, voire voulu.
--
-- (Le mode « uniquement pendant la période » — qui exigerait d'alerter sur le
-- travail HORS période — est un lot distinct, volontairement absent.)
--
-- Rétro-compatibilité : les adhésions existantes signifiaient « fermé » —
-- le backfill les y traduit. Les booléens (203/207) restent en place,
-- DÉPRÉCIÉS : les colonnes d'effet sont désormais la seule vérité lue.
--
-- Additive, idempotente. Rollback : DROP COLUMN ×2.

alter table public.sites
  add column if not exists school_calendar_effect text not null default 'none'
    check (school_calendar_effect in ('none', 'closed', 'works'));

alter table public.sites
  add column if not exists public_holidays_effect text not null default 'none'
    check (public_holidays_effect in ('none', 'closed', 'works'));

-- Les adhérents existants fermaient : ils continuent de fermer. Aucun
-- comportement ne change sans geste humain.
update public.sites
  set school_calendar_effect = 'closed'
  where follows_school_calendar = true and school_calendar_effect = 'none';

update public.sites
  set public_holidays_effect = 'closed'
  where follows_public_holidays = true and public_holidays_effect = 'none';

comment on column public.sites.school_calendar_effect is
  'Effet des vacances scolaires SUR CE CHANTIER : none (non concerné) | closed (fermé — seul mode qui produit des site_closures) | works (travail prévu pendant la période). Le calendrier décrit le contexte ; le chantier décrit la règle.';
comment on column public.sites.public_holidays_effect is
  'Effet des jours fériés SUR CE CHANTIER : none | closed | works. Même règle que school_calendar_effect.';
