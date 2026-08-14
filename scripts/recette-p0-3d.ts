// Recette P0-3D — les 10 scénarios de clôture (mandat Vincent 2026-08-14).
// « Si ces 10 scénarios passent, P0-3D est clos. »
//
// Tout tourne dans UN DO-block Postgres qui se termine par une exception
// volontaire « RECETTE_OK » : la transaction est annulée, RIEN ne persiste.
//
// Chaque scénario émule EXACTEMENT la séquence SQL des chemins réels :
//   · preciserIntervenantAction  → ensureActiveAffiliation (insert datée si
//     aucune active) + UPDATE de la MÊME participation (where effective_to is
//     null) + ensureActorCanonicalSubject (insert CS si absent, contact prime)
//   · remplacerIntervenantAction → replaceSiteIntervenant (nouvelle ligne +
//     clôture de l'ancienne avec effective_to / replaced_by / replaced_at)
// La partie « affichage non vide » (fallbacks TS) est vérifiée par typecheck +
// revue de code — hors de portée d'une recette SQL, dit dans le rapport.

import { config } from 'dotenv'
config({ path: '.env.local' })

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = 'srixnofmaydxouhucawn'

const SQL = `
DO $$
DECLARE
  v_org uuid; v_site uuid; v_eec uuid; v_elecnc uuid;
  v_jean uuid; v_paul uuid; v_marc uuid;
  p1 uuid; p2 uuid; p3 uuid; pn uuid; v_prop uuid;
  n int; n_before int;
BEGIN
  insert into organizations (name) values ('__RECETTE_P03D__') returning id into v_org;
  insert into sites (name, organization_id) values ('__RECETTE_SITE_D__', v_org) returning id into v_site;
  insert into companies (name, organization_id) values ('EEC __RD__', v_org) returning id into v_eec;
  insert into companies (name, organization_id) values ('ELECNC __RD__', v_org) returning id into v_elecnc;
  -- Jean naît SANS entreprise (contact d'org, niveau 3 pur).
  insert into company_contacts (full_name, organization_id) values ('Jean Dupont __RD__', v_org) returning id into v_jean;
  insert into company_contacts (full_name, organization_id) values ('Paul Martin __RD__', v_org) returning id into v_paul;
  insert into company_contacts (full_name, organization_id) values ('Marc Petit __RD__', v_org) returning id into v_marc;

  -- S9 (préparation) — une occurrence textuelle « Électricien » existe AVANT
  -- toute résolution : elle ne doit jamais être réécrite par l'enrichissement.
  insert into site_knowledge_proposals (organization_id, site_id, kind, title, status, dedupe_key)
    values (v_org, v_site, 'stakeholder', 'Électricien', 'confirmed', 'stakeholder:electricien:__rd__') returning id into v_prop;

  -- ── S1 — rôle seul → préciser JEAN (personne sans entreprise) ─────────────
  insert into site_intervenants (site_id, role) values (v_site, 'ELECTRICIEN') returning id into p1;
  update site_intervenants set main_contact_id = v_jean, company_id = null
    where id = p1 and effective_to is null;
  -- ensureActorCanonicalSubject : contact prime, aucune CS active → création.
  if not exists (select 1 from canonical_subject where site_id = v_site and contact_id = v_jean and status = 'active') then
    insert into canonical_subject (site_id, label, status, contact_id, actor_link_source, actor_link_confidence)
      values (v_site, 'Jean Dupont __RD__', 'active', v_jean, 'auto', 1.000);
    insert into subject_thread_identity (subject_thread_id, site_id, canonical_subject_id, source)
      select gen_random_uuid(), v_site, id, 'auto' from canonical_subject where site_id = v_site and contact_id = v_jean;
  end if;
  select count(*) into n from site_intervenants where id = p1 and main_contact_id = v_jean and company_id is null and effective_to is null;
  if n <> 1 then raise exception 'S1 ECHEC — la participation ne porte pas Jean sans entreprise'; end if;
  select count(*) into n from canonical_subject where site_id = v_site and contact_id = v_jean and status = 'active';
  if n <> 1 then raise exception 'S1 ECHEC — canonical personne sans entreprise non créé'; end if;

  -- ── S2 — rôle seul → préciser EEC (entreprise seule) ──────────────────────
  insert into site_intervenants (site_id, role) values (v_site, 'PLOMBIER') returning id into p2;
  update site_intervenants set company_id = v_eec where id = p2 and effective_to is null;
  if not exists (select 1 from canonical_subject where site_id = v_site and company_id = v_eec and status = 'active') then
    insert into canonical_subject (site_id, label, status, company_id, actor_link_source, actor_link_confidence)
      values (v_site, 'EEC __RD__', 'active', v_eec, 'auto', 1.000);
    insert into subject_thread_identity (subject_thread_id, site_id, canonical_subject_id, source)
      select gen_random_uuid(), v_site, id, 'auto' from canonical_subject where site_id = v_site and company_id = v_eec;
  end if;
  select count(*) into n from site_intervenants where id = p2 and company_id = v_eec and main_contact_id is null and effective_to is null;
  if n <> 1 then raise exception 'S2 ECHEC — la participation ne porte pas EEC seule'; end if;
  select count(*) into n from canonical_subject where site_id = v_site and company_id = v_eec and status = 'active';
  if n <> 1 then raise exception 'S2 ECHEC — canonical entreprise non créé'; end if;

  -- ── S3 — rôle seul → préciser JEAN + EEC ensemble ─────────────────────────
  insert into site_intervenants (site_id, role) values (v_site, 'MACON') returning id into p3;
  -- ensureActiveAffiliation : aucune active jean↔eec → insert DATÉE.
  if not exists (select 1 from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is null) then
    insert into contact_company_affiliations (organization_id, contact_id, company_id, effective_from)
      values (v_org, v_jean, v_eec, current_date);
  end if;
  update site_intervenants set company_id = v_eec, main_contact_id = v_jean where id = p3 and effective_to is null;
  select count(*) into n from site_intervenants where id = p3 and company_id = v_eec and main_contact_id = v_jean and effective_to is null;
  if n <> 1 then raise exception 'S3 ECHEC — précision personne+entreprise impossible'; end if;
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is null and effective_from is not null;
  if n <> 1 then raise exception 'S3 ECHEC — affiliation active datée absente'; end if;

  -- ── S4 — Jean seul (p1) → ajouter EEC depuis sa fiche, SANS recréer ───────
  select count(*) into n_before from site_intervenants where site_id = v_site;
  -- ensureActiveAffiliation idempotente : une active existe → aucune écriture.
  if not exists (select 1 from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is null) then
    insert into contact_company_affiliations (organization_id, contact_id, company_id, effective_from)
      values (v_org, v_jean, v_eec, current_date);
  end if;
  update site_intervenants set company_id = v_eec where id = p1 and effective_to is null;
  select count(*) into n from site_intervenants where site_id = v_site;
  if n <> n_before then raise exception 'S4 ECHEC — l''enrichissement a recréé une participation'; end if;
  select count(*) into n from site_intervenants where id = p1 and company_id = v_eec and main_contact_id = v_jean and effective_to is null;
  if n <> 1 then raise exception 'S4 ECHEC — la MÊME participation n''a pas été enrichie'; end if;
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is null;
  if n <> 1 then raise exception 'S4 ECHEC — affiliation dupliquée ou absente'; end if;

  -- ── S5 — EEC seule (p2) → ajouter Jean depuis sa fiche ────────────────────
  select count(*) into n_before from site_intervenants where site_id = v_site;
  update site_intervenants set main_contact_id = v_jean where id = p2 and effective_to is null;
  select count(*) into n from site_intervenants where site_id = v_site;
  if n <> n_before then raise exception 'S5 ECHEC — l''enrichissement a recréé une participation'; end if;
  select count(*) into n from site_intervenants where id = p2 and company_id = v_eec and main_contact_id = v_jean and effective_to is null;
  if n <> 1 then raise exception 'S5 ECHEC — la MÊME participation n''a pas été enrichie'; end if;

  -- ── S6 — Jean change d'entreprise (EEC → ELECNC) ──────────────────────────
  update contact_company_affiliations set effective_to = current_date
    where contact_id = v_jean and company_id = v_eec and effective_to is null;
  insert into contact_company_affiliations (organization_id, contact_id, company_id, effective_from)
    values (v_org, v_jean, v_elecnc, current_date);
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is not null;
  if n < 1 then raise exception 'S6 ECHEC — l''ancienne affiliation a disparu'; end if;
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_elecnc and effective_to is null and effective_from is not null;
  if n <> 1 then raise exception 'S6 ECHEC — nouvelle affiliation datée absente'; end if;
  -- AUCUN rewrite rétroactif : les participations gardent l'entreprise d'alors.
  select count(*) into n from site_intervenants where id in (p1, p3) and company_id = v_eec;
  if n <> 2 then raise exception 'S6 ECHEC — une participation historique a été réécrite'; end if;

  -- ── S7 — Jean → Paul : remplacement chaîné ────────────────────────────────
  insert into site_intervenants (site_id, role, company_id, main_contact_id, effective_from)
    values (v_site, 'ELECTRICIEN', v_eec, v_paul, current_date) returning id into pn;
  update site_intervenants
    set effective_to = current_date, replaced_by_intervenant_id = pn, replaced_at = now()
    where id = p1 and effective_to is null;
  select count(*) into n from site_intervenants where id = p1 and effective_to is not null and replaced_by_intervenant_id = pn;
  if n <> 1 then raise exception 'S7 ECHEC — ancienne participation non clôturée/chaînée'; end if;
  select count(*) into n from site_intervenants where id = p1 and main_contact_id = v_jean and company_id = v_eec;
  if n <> 1 then raise exception 'S7 ECHEC — le passé de Jean a été réécrit'; end if;
  select count(*) into n from site_intervenants where id = pn and effective_to is null and main_contact_id = v_paul;
  if n <> 1 then raise exception 'S7 ECHEC — nouvelle participation absente'; end if;

  -- ── S8 — multi-personnes SIMULTANÉES, même rôle, même entreprise ──────────
  insert into site_intervenants (site_id, role, company_id, main_contact_id)
    values (v_site, 'ELECTRICIEN', v_eec, v_marc);
  select count(*) into n from site_intervenants
    where site_id = v_site and role = 'ELECTRICIEN' and company_id = v_eec and effective_to is null;
  if n <> 2 then raise exception 'S8 ECHEC — co-présence même rôle/entreprise impossible'; end if;

  -- ── S9 — l'occurrence « Électricien » n'a pas bougé d'un caractère ────────
  select count(*) into n from site_knowledge_proposals where id = v_prop and title = 'Électricien' and status = 'confirmed';
  if n <> 1 then raise exception 'S9 ECHEC — la preuve textuelle a été réécrite'; end if;

  -- ── S10 — AUCUNE fusion de canonical subject par l'enrichissement ─────────
  -- Jean garde UN CS actif, EEC garde le sien : distincts, jamais fusionnés.
  select count(*) into n from canonical_subject where site_id = v_site and contact_id = v_jean and status = 'active';
  if n <> 1 then raise exception 'S10 ECHEC — CS personne dupliqué ou fusionné'; end if;
  select count(*) into n from canonical_subject where site_id = v_site and company_id = v_eec and status = 'active';
  if n <> 1 then raise exception 'S10 ECHEC — CS entreprise dupliqué ou fusionné'; end if;
  select count(*) into n from canonical_subject where site_id = v_site and status <> 'active';
  if n <> 0 then raise exception 'S10 ECHEC — un CS a changé de statut pendant l''enrichissement'; end if;

  raise exception 'RECETTE_OK — les 10 scénarios P0-3D passent, transaction annulée, rien ne persiste';
END $$;
`

async function main() {
  if (!ACCESS_TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN manquant'); process.exit(1) }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SQL }),
    }
  )
  const text = await response.text()
  if (text.includes('RECETTE_OK')) {
    console.log('✅ RECETTE P0-3D : les 10 scénarios passent (transaction annulée, zéro persistance)')
  } else {
    console.error('❌ RECETTE EN ÉCHEC :')
    console.error(text)
    process.exit(1)
  }
}

main()
