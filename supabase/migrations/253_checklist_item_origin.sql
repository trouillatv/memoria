-- mig 253 : référence vers le modèle pour un item de checklist personnalisé
--
-- Complète la mig 252. Quand un item hérité du modèle de mission
-- ('mission_template') est ÉDITÉ sur une intervention précise (renommé, rendu
-- obligatoire/facultatif), il DIVERGE : il devient 'local' et garde ici la
-- trace du libellé du modèle dont il provient.
--
-- Pourquoi (doctrine, Vincent 2026-07-29) :
--   Sans cette référence, un item du modèle renommé sur une intervention reste
--   marqué 'mission_template' — au prochain diff (Lot 2 : propagation d'une
--   évolution du modèle) on ne sait plus si c'est un item modifié, un nouvel
--   item, ou l'ancien renommé. On perd l'information là où elle compte.
--
-- Sémantique de origin_template_label :
--   NULL                → item du modèle intact, OU item ajouté de toutes pièces
--                          (source='local' sans origine).
--   non NULL            → item issu du modèle mais personnalisé pour cette
--                          intervention. La valeur = libellé du modèle d'origine,
--                          clé de réconciliation pour la propagation.

alter table public.intervention_checklist_items
  add column origin_template_label text;

comment on column public.intervention_checklist_items.origin_template_label is
  'Libellé du modèle de mission dont cet item local provient (personnalisation). NULL = item intact ou ajout local pur.';
