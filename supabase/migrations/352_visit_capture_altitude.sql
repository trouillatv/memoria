-- 352_visit_capture_altitude.sql
-- Altitude de capture (Vincent, 2026-08-26) — additif, nullable.
--
-- Contrat (même philosophie que gps_accuracy_m, mig 351) :
--   • altitude_m = coords.altitude du navigateur au moment de la capture.
--     NULL quand le navigateur ne fournit pas de valeur (fréquent) — jamais
--     une valeur inventée.
--   • altitude_accuracy_m = coords.altitudeAccuracy, même règle NULL.
--   • Pas de corrected_altitude_m : corriger une altitude en déplaçant un
--     point sur une carte 2D n'a pas de sens. À revisiter seulement si
--     MemorIA acquiert un MNT, des niveaux de bâtiment ou des données
--     topographiques.
--   • Une altitude de GPS de smartphone n'est pas une cote topographique de
--     géomètre : preuve contextuelle brute avec sa précision, jamais une
--     vérité terrain affichée sans nuance.

alter table visit_capture
  add column if not exists altitude_m double precision null;

alter table visit_capture
  add column if not exists altitude_accuracy_m double precision null;

comment on column visit_capture.altitude_m is
  'Altitude GPS brute au moment de la capture (coords.altitude), mètres. NULL quand le navigateur ne fournit pas de valeur exploitable — jamais une valeur inventée. Pas une cote topographique de géomètre : preuve contextuelle brute, cf. altitude_accuracy_m.';
comment on column visit_capture.altitude_accuracy_m is
  'Précision de altitude_m (coords.altitudeAccuracy), mètres. NULL quand le navigateur ne fournit pas de valeur exploitable.';
