-- 180 — Évaluation de niveau 2 + « ce qui manque » (Vincent 2026-06-30)
--
-- Le niveau 1 (verdict par affirmation, mig 179) ne suffit pas : un conducteur ne
-- juge pas affirmation par affirmation, il se demande « est-ce que cette IA a
-- compris MON chantier ? ». On ajoute donc, par RUN :
--
--  • global_verdict — LE test de transmission : « cette synthèse te permettrait-elle
--    de transmettre l'affaire à un collègue ? ». 12 affirmations justes peuvent ne
--    rien raconter ; 5 affirmations peuvent suffire à comprendre. Ce verdict capte
--    ça (cf. continuité / passage de témoin).
--
--  • missing_note — « Il manque quelque chose » : zone de texte libre des OMISSIONS.
--    C'est l'or de l'évaluation : les 4 verdicts ne révèlent jamais ce que l'IA
--    OUBLIE systématiquement (les accès, les réseaux, les nuisances, les demandes
--    implicites du client). Cette donnée découvre les biais de l'IA.

alter table public.comprehension_runs
  add column if not exists global_verdict text
    check (global_verdict in ('transmissible', 'corrections', 'incomplet', 'trompeur')),
  add column if not exists global_verdict_by uuid references public.users(id) on delete set null,
  add column if not exists global_verdict_at timestamptz,
  add column if not exists missing_note text;
