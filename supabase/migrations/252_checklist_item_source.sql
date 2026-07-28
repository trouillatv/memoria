-- mig 252 : source d'un item de checklist d'intervention
--
-- Distingue les items hérités du modèle de mission ('mission_template')
-- des items ajoutés localement pour une intervention précise ('local').
--
-- Doctrine Lot 1 (2026-07-29) :
--   - une intervention `planned` peut être éditée par admin/manager/chef_equipe
--   - les items 'local' ne sont jamais touchés par une propagation future
--   - la restauration depuis le modèle supprime uniquement les 'mission_template'
--
-- Lot 2 (à venir) : propagation contrôlée depuis la mission vers les
-- interventions `planned` non démarrées, sans écraser les 'local'.
-- Nécessitera un `template_item_key` pour la réconciliation diff.

alter table public.intervention_checklist_items
  add column source text not null default 'mission_template'
    constraint intervention_checklist_items_source_check
      check (source in ('mission_template', 'local'));

comment on column public.intervention_checklist_items.source is
  'Provenance : mission_template = copié du modèle, local = ajouté pour cette intervention.';
