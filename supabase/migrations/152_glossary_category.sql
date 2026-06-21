-- Glossaire métier — catégorie (Vincent 2026-06-21). Au-delà de terme/définition/
-- alias, on classe le terme : engin / matériau / document / processus / contrôle…
-- Sert l'organisation ET le futur raisonnement IA (« finisseur en panne » → « engin
-- critique indisponible ») — SANS rien câbler d'IA aujourd'hui : juste le champ.

alter table public.glossary_terms
  add column if not exists category text;

comment on column public.glossary_terms.category is
  'Catégorie métier libre du terme (engin / matériau / document / processus / contrôle…). Donne du contexte au futur raisonnement IA. NULL = non classé.';
