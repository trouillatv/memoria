-- 177 — Idempotence des captures de visite : client_uuid (Vincent 2026-06-30)
--
-- Lot B « la capture ne bloque jamais » : photo / vidéo / vocal sont déposées
-- dans une file IndexedDB locale, puis montées en arrière-plan (retry réseau).
-- Un même envoi peut être REJOUÉ (réponse perdue, reprise au retour du réseau) :
-- il faut une identité idempotente au niveau de la CAPTURE, exactement comme
-- site_report_attachments en a déjà une (client_uuid, mig 051). Sans ça, un
-- re-drain créerait une 2ᵉ capture pour la même photo.
--
-- client_uuid est généré côté client (crypto.randomUUID), AVANT tout réseau.
-- Nullable : les captures déjà en base, et les gestes 100 % serveur qui ne
-- passent pas par la file (note / vérification / position), n'en portent pas.
-- Unicité PARTIELLE : seule une valeur non-nulle est contrainte (plusieurs
-- captures legacy à NULL doivent coexister).

alter table public.visit_capture
  add column if not exists client_uuid uuid;

create unique index if not exists visit_capture_client_uuid_key
  on public.visit_capture (client_uuid)
  where client_uuid is not null;
