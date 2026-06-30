-- 178 — « Vérifié » stocke la RÉPONSE, pas juste le statut (Vincent 2026-06-30)
--
-- Un point à vérifier (captured_knowledge kind='question') passait de 'active' à
-- 'resolved' sans garder CE QU'ON A TROUVÉ. Or pour une réponse AO, la valeur
-- n'est pas « c'est résolu » mais « le diamètre est 200, le compteur est en
-- limite de propriété… ». On conserve donc la réponse à côté de la question.
--
-- `resolution` = texte libre de la réponse trouvée (nullable : on peut clore sans
-- saisir, mais le champ existe et c'est le chemin encouragé). `resolved_at` pour
-- dater « vérifié le … ».

alter table public.captured_knowledge
  add column if not exists resolution text,
  add column if not exists resolved_at timestamptz;
