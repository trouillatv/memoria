-- =============================================================================
-- 126 — VERSION FINALE DIFFUSÉE du CR (téléversée par l'humain).
--
-- La CR générée est déterministe (« mémoire d'abord »). Mais avant diffusion, le
-- conducteur/Émeline retouche toujours ~15 % (formulation, ajouts) dans le DOCX/PDF,
-- puis envoie. Cette version finale = la VÉRITÉ JURIDIQUE : ce qui a réellement été
-- diffusé aux intervenants — la preuve la plus précieuse.
--
-- Doctrine (Vincent 2026-06-20) : on STOCKE la version finale et on la LIE à la
-- réunion. On N'ÉCRASE PAS la mémoire automatiquement (comparaison des écarts +
-- apprentissage = Niveau 2/3, plus tard). 3 états : généré → validé → final diffusé.
-- =============================================================================

alter table public.report_documents
  add column if not exists final_document_id uuid references public.documents(id) on delete set null,
  add column if not exists final_path        text,
  add column if not exists finalized_at      timestamptz,
  add column if not exists finalized_by      uuid references public.users(id) on delete set null;
