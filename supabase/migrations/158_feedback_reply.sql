-- 158 — Réponse de l'équipe au feedback (Vincent 2026-06-23)
--
-- L'admin peut RÉPONDRE à un retour depuis /admin/feedback. La réponse revient
-- à l'auteur, affichée dans le bouton feedback (« Réponses de l'équipe »).
--
-- Doctrine inchangée (075) : pas de mail/Slack, tout reste dans MemorIA. Les
-- mutations & lectures passent par des Server Actions (admin client + contrôle
-- de rôle/propriété), donc pas de nouvelle policy RLS nécessaire.

alter table public.feedback
  add column if not exists admin_reply    text
    check (admin_reply is null or length(admin_reply) <= 4000),
  add column if not exists admin_reply_at timestamptz,
  add column if not exists admin_reply_by uuid references public.users(id) on delete set null,
  add column if not exists reply_seen_at  timestamptz;

comment on column public.feedback.admin_reply is
  'Réponse de l''équipe à l''auteur (Vincent 2026-06-23). Visible par l''auteur via le bouton feedback. reply_seen_at = horodatage de lecture par l''auteur (NULL = non lue).';
