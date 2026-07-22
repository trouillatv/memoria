-- ============================================================
-- 232 — L'entreprise « À identifier »
-- ============================================================
-- Sur un chantier, on croise quelqu'un avant de savoir pour qui il travaille.
-- Le schéma, lui, l'interdisait : `site_intervenants.company_id` et
-- `company_contacts.company_id` sont NOT NULL (mig 137). Confirmer « Yann »
-- sans société était donc impossible, et l'écran répondait par un refus — il
-- demandait une information que le terrain n'a pas encore.
--
-- Décision (Vincent, 2026-07-22) : une entreprise d'attente par organisation,
-- à laquelle se rattachent les personnes dont la société reste à établir.
--
-- ── LE DÉFAUT DE CE CHOIX, ET CE QUI LE NEUTRALISE ─────────────────────────
--
-- Une fausse société dans le référentiel se retrouve PARTOUT : dans les
-- sélecteurs, les statistiques, les listes de sociétés. `is_placeholder` existe
-- pour que le code puisse la reconnaître SANS comparer son nom — un libellé se
-- traduit, se corrige, se renomme ; un drapeau non.
--
-- Le piège le moins visible est ailleurs. Le moteur de rapprochement d'identité
-- (`lib/acteurs/resolution-identite`) majore un score quand deux personnes
-- partagent une entreprise. Dix personnes rattachées à « À identifier »
-- deviendraient donc dix collègues présumés, et le moteur fabriquerait des
-- doublons au lieu d'en éviter. Toute lecture qui alimente ce moteur doit donc
-- rendre `null` pour cette entreprise, jamais son nom.
--
-- UNE SEULE PAR ORGANISATION : sans cette contrainte, chaque appel concurrent
-- en créerait une, et le référentiel finirait avec quatre « À identifier ».
--
-- Additive : aucune donnée existante n'est touchée, aucune entreprise n'est
-- créée ici — la première naît à la première personne sans société.

alter table public.companies
  add column if not exists is_placeholder boolean not null default false;

comment on column public.companies.is_placeholder is
  'Entreprise d''ATTENTE (« À identifier »), pas une société réelle : elle porte les personnes dont l''employeur reste à établir. À exclure des sélecteurs, des statistiques, et surtout de tout rapprochement d''identité — sinon ses contacts passent pour des collègues.';

-- Au plus une entreprise d'attente par organisation.
create unique index if not exists companies_one_placeholder_per_org
  on public.companies(organization_id)
  where is_placeholder and deleted_at is null;
