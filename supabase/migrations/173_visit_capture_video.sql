-- 173 — geste VIDÉO dans le panier de visite (Vincent 2026-06-29)
--
-- Justifié par l'usage (Guillaume filme en prévisite), pas par l'architecture :
-- une vidéo porte plus que des photos isolées (contexte, déplacement, commentaire
-- spontané, ambiance) → matière première plus riche pour les lectures et, plus tard,
-- l'IA. V1 = un 5ᵉ geste qui réutilise EXACTEMENT la plomberie photo (upload →
-- pièce jointe → capture), plafonné à 20 Mo (clip court). L'upload lourd (URL
-- signée) viendra SI l'usage le réclame — pas avant. Cf. [[visite-trois-temps]].

-- La capture peut être de kind 'video'.
alter table public.visit_capture drop constraint if exists visit_capture_kind_check;
alter table public.visit_capture add constraint visit_capture_kind_check
  check (kind in ('photo', 'vocal', 'note', 'verification', 'position', 'video'));

-- La pièce jointe peut être de kind 'video' (réutilise site_report_attachments).
alter table public.site_report_attachments drop constraint if exists site_report_attachments_kind_check;
alter table public.site_report_attachments add constraint site_report_attachments_kind_check
  check (kind in ('audio', 'photo', 'file', 'video'));
