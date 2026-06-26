-- 162 — Visites terrain (Vincent 2026-06-26)
--
-- Doctrine : une VISITE n'est pas un nouvel objet. C'est un `site_report`
-- orienté objectif. On N'AJOUTE PAS de table : on ENRICHIT site_reports.
--
-- Règle produit : AUCUNE information métier n'est obligatoire. MemorIA doit
-- toujours essayer de DÉDUIRE avant de demander. (Cf. [[deduire-avant-de-demander]].)
--
-- MVP = friction zéro. On démarre une visite en 1 clic : AUCUNE question au
-- départ (pas de motif, pas d'objectif, pas de cible). On capture (photo/vocal/
-- note/réserve/action), on clôture. objectif / sujet / résultat / résolution
-- sont FACULTATIFS. Cible produit : ils sont alimentés SILENCIEUSEMENT pendant
-- la visite (IA) puis MONTRÉS à la clôture pour confirmation/ignore — jamais
-- demandés. Au MVP (pas d'IA) : montrés vides à la clôture, remplis à la main.
--
-- La visite est une LENTILLE (fenêtre temporelle) sur la mémoire du SITE, pas un
-- conteneur : les objets produits s'attachent au site et CITENT le report, ils
-- ne tombent pas dans la visite. Marqueur : `origin IS NOT NULL` distingue une
-- visite terrain d'une réunion classique (origin auto-renseigné au démarrage).
--
-- Invariant : tout résultat qualifie un LIEU / un OUVRAGE / un SUJET, JAMAIS
-- une personne ni une entreprise (cf. doctrine-rh / refus-erp-rh-pointage-gps).

-- ── Démarrage (auto, zéro question) ──────────────────────────────────────────

-- Origine = métadonnée auto (comment on est entré). NON-NULL = visite terrain.
alter table public.site_reports add column if not exists origin text
  check (origin is null or origin in ('planned', 'spontaneous', 'qr', 'gps'));

alter table public.site_reports add column if not exists started_at timestamptz;
alter table public.site_reports add column if not exists ended_at   timestamptz;

-- ── Clôture (tout facultatif) ────────────────────────────────────────────────

-- Motif : facultatif, nullable. Posé à la clôture si renseigné (ou plus tard par
-- l'IA). Ne sert PLUS de marqueur. Routera le rail preuve au cran 2.
alter table public.site_reports add column if not exists visit_motive text
  check (visit_motive is null or visit_motive in (
    'inspection', 'controle', 'reunion', 'avancement', 'reception',
    'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre'
  ));

-- Objectif libre ("contrôler les enrobés"). Facultatif.
alter table public.site_reports add column if not exists objective text;

-- Cible = le SUJET concerné (recherche-par-sujet = douleur n°1). Facultatif.
-- Au MVP : lien au sujet seulement (pas de cible polymorphe).
alter table public.site_reports add column if not exists target_subject_id uuid
  references public.subjects(id) on delete set null;

-- Résultat global : état de l'OUVRAGE / de la ZONE. Jamais de la personne.
alter table public.site_reports add column if not exists outcome text
  check (outcome is null or outcome in (
    'ras', 'conforme', 'conforme_reserves', 'non_conforme', 'a_revoir', 'info'
  ));

-- Résolution : axe ORTHOGONAL à outcome. La visite peut être terminée alors que
-- le sujet ne l'est pas. Qualifie le SUJET.
alter table public.site_reports add column if not exists resolution text
  check (resolution is null or resolution in ('resolue', 'a_suivre', 'recontrole'));

comment on column public.site_reports.origin is
  'Origine auto d''une visite terrain (mig 162). NON-NULL = visite ; NULL = réunion/compte-rendu classique. Jamais demandé à l''utilisateur.';
comment on column public.site_reports.outcome is
  'Résultat global d''une visite : état de l''OUVRAGE/ZONE/SUJET, JAMAIS de la personne (invariant anti-RH).';
comment on column public.site_reports.resolution is
  'Le sujet/la cible est-il traité ? resolue|a_suivre|recontrole. Orthogonal à outcome. Posé seulement s''il y a un objectif/sujet.';

-- Index : retrouver vite les visites d'un site (origin distingue de la réunion).
create index if not exists sr_site_visit_idx
  on public.site_reports (site_id, started_at desc)
  where origin is not null;
