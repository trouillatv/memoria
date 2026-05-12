# MC-4 — Voice notes storage (bucket Supabase)

## Bucket

La migration `031_tender_voice_note.sql` crée automatiquement le bucket
`tender-voice-notes` via `insert into storage.buckets (..., public=false)`.

Si pour une raison quelconque le bucket n'est pas créé par la migration
(droits insuffisants côté Management API), il faut le créer manuellement :

**Supabase Dashboard → Storage → New bucket :**

- Name : `tender-voice-notes`
- Public : OFF (privé, RLS strict)
- File size limit : 8 MB (cap aussi appliqué côté server action)
- Allowed MIME types : `audio/webm`, `audio/mp4`, `audio/ogg` (optionnel)

## Politiques RLS

La migration installe une policy `SELECT` pour `authenticated`. Les opérations
`INSERT` / `DELETE` passent par les **server actions** avec le service role
(qui bypass RLS), donc pas de policy nécessaire pour ces verbes.

Lecture côté UI : utilise `getSignedVoiceNoteUrl` (TTL 1h) côté serveur,
le client reçoit une URL signée. Pas d'exposition de path brut au client.

## Sécurité métier

- Server action `saveVoiceNoteAction` exige le rôle `manager` ou `admin`.
  Pas accessible aux `chef_equipe`.
- Garde-fou : refuse l'enregistrement si `tender.outcome IS NULL`
  (doctrine V5 — voice notes strictement restreintes aux AO finalisés).
- Cap dur 8 MB côté action (3 min @ ~40kbps webm/opus ≈ 1 MB max attendu).
- CHECK contrainte SQL : `voice_note_duration_seconds BETWEEN 1 AND 180`.

## Doctrine V5

Voice note = archive personnelle DG, pas une conversation.
Pas exposée au client final. Pas dans le rapport mensuel. Pas dans les
exports PDF. Visible uniquement dans la page tender détail
(`/tenders/[id]`) et signalée sobrement dans `/tenders/memoire`
(badge "Note vocale · 1min24" sans player inline).
