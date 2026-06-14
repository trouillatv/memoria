-- Migration 094 : categories d'anomalies chantier BTP
-- Ajoute les cas terrain frequents sans retirer les anciennes valeurs,
-- afin de conserver l'historique existant.

alter type public.anomaly_category add value if not exists 'electricite_coupee';
alter type public.anomaly_category add value if not exists 'zone_non_prete';
alter type public.anomaly_category add value if not exists 'danger_securite';
alter type public.anomaly_category add value if not exists 'livraison_probleme';
