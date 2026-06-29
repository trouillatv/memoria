-- 176 — « Reporter » une action : expliquer pourquoi elle reste ouverte (Vincent 2026-06-29)
--
-- Décision : sur le terrain, Guillaume tombe parfois sur une action qu'il ne peut
-- PAS traiter aujourd'hui (attente client, matériel manquant, météo…). Plutôt que
-- de ne rien faire, il pose un motif. Ce n'est PAS un workflow ni un blocage formel
-- (table site_blocages, réservée manager) : juste une annotation légère, posée par
-- le chef, qui explique pourquoi l'action traîne. L'action reste 'open'.
--
-- Champ nullable, non bloquant, sans trigger d'immuabilité (ce n'est pas une preuve).

alter table public.site_actions
  add column if not exists snooze_reason text,
  add column if not exists snoozed_at timestamptz;
