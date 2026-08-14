// Recette du MODÈLE P0-3A+B sur les 10 scénarios (doctrine 4 niveaux).
// Tout tourne dans UN DO-block Postgres qui se termine par une exception
// volontaire « RECETTE_OK » : la transaction est annulée, RIEN ne persiste.
// Si un scénario échoue, son assert nomme précisément le point cassé.

import { config } from 'dotenv'
config({ path: '.env.local' })

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = 'srixnofmaydxouhucawn'

const SQL = `
DO $$
DECLARE
  v_org uuid; v_site uuid; v_eec uuid; v_elec uuid; v_jean uuid; v_paul uuid;
  p1 uuid; p2 uuid; pn uuid;
  n int;
BEGIN
  insert into organizations (name) values ('__RECETTE_P03__') returning id into v_org;
  insert into sites (name, organization_id) values ('__RECETTE_SITE__', v_org) returning id into v_site;
  insert into companies (name, organization_id) values ('EEC __R__', v_org) returning id into v_eec;
  insert into companies (name, organization_id) values ('ELECNC __R__', v_org) returning id into v_elec;
  insert into company_contacts (full_name, organization_id, company_id) values ('Jean Dupond __R__', v_org, v_eec) returning id into v_jean;
  insert into company_contacts (full_name, organization_id) values ('Paul Martin __R__', v_org) returning id into v_paul;

  -- S1 — « l'électricien » : rôle seul, aucune identité inventée.
  insert into site_intervenants (site_id, role) values (v_site, 'ELECTRICIEN') returning id into p1;
  select count(*) into n from site_intervenants where id = p1 and company_id is null and main_contact_id is null;
  if n <> 1 then raise exception 'S1 ECHEC — rôle seul non représentable'; end if;

  -- S2 — identifier la personne : MÊME participation, le rôle reste.
  update site_intervenants set main_contact_id = v_jean where id = p1;

  -- S4/S6 — compléter l'entreprise : la même participation s'enrichit.
  update site_intervenants set company_id = v_eec where id = p1;
  select count(*) into n from site_intervenants where id = p1 and role='ELECTRICIEN' and main_contact_id = v_jean and company_id = v_eec and effective_to is null;
  if n <> 1 then raise exception 'S2/S4/S6 ECHEC — enrichissement progressif impossible'; end if;

  -- S3 — entreprise seule, personne inconnue.
  insert into site_intervenants (site_id, role, company_id) values (v_site, 'PLOMBIER', v_eec);

  -- S5 — correction de NATURE : « Paul » détecté personne était une entreprise.
  -- On corrige la RÉSOLUTION de la participation ; l'entité Paul n'est pas détruite.
  insert into site_intervenants (site_id, role, main_contact_id) values (v_site, 'MOE', v_paul) returning id into p2;
  update site_intervenants set main_contact_id = null, company_id = v_elec where id = p2;
  select count(*) into n from company_contacts where id = v_paul;
  if n <> 1 then raise exception 'S5 ECHEC — la correction a détruit une identité'; end if;

  -- S7/S8 — Jean remplacé par Paul (même rôle, même entreprise) : chaînage.
  insert into site_intervenants (site_id, role, company_id, main_contact_id, effective_from)
    values (v_site, 'ELECTRICIEN', v_eec, v_paul, current_date) returning id into pn;
  update site_intervenants set effective_to = current_date, replaced_by_intervenant_id = pn, replaced_at = now() where id = p1;
  select count(*) into n from site_intervenants where id = p1 and replaced_by_intervenant_id = pn and effective_to is not null;
  if n <> 1 then raise exception 'S7 ECHEC — chaînage de remplacement impossible'; end if;
  select count(*) into n from site_intervenants where id = p1 and main_contact_id = v_jean and company_id = v_eec;
  if n <> 1 then raise exception 'S7 ECHEC — le passé de Jean a été réécrit'; end if;

  -- S9 — Jean change d'entreprise (EEC → ELECNC) : le passé ne bouge JAMAIS.
  -- (Affiliation courante d'abord — dans la vraie vie, créée au moment où le
  -- contact rejoint l'entreprise ; le backfill 321 l'a fait pour l'existant.)
  insert into contact_company_affiliations (organization_id, contact_id, company_id)
    values (v_org, v_jean, v_eec);
  update contact_company_affiliations set effective_to = current_date
    where contact_id = v_jean and company_id = v_eec and effective_to is null;
  insert into contact_company_affiliations (organization_id, contact_id, company_id, effective_from)
    values (v_org, v_jean, v_elec, current_date);
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_eec and effective_to is not null;
  if n < 1 then raise exception 'S9 ECHEC — l''affiliation passée a disparu'; end if;
  select count(*) into n from contact_company_affiliations where contact_id = v_jean and company_id = v_elec and effective_to is null;
  if n <> 1 then raise exception 'S9 ECHEC — nouvelle affiliation absente'; end if;
  select count(*) into n from site_intervenants where id = p1 and company_id = v_eec;
  if n <> 1 then raise exception 'S9 ECHEC — la participation historique a été réécrite'; end if;

  -- S10 — correction orthographique : l'identité seule change, les liens tiennent.
  update company_contacts set full_name = 'Jean Dupont __R__' where id = v_jean;
  select count(*) into n from site_intervenants where main_contact_id = v_jean;
  if n < 1 then raise exception 'S10 ECHEC — liens perdus après renommage'; end if;

  -- Garde-fou : le doublon ACTIF strictement identique est refusé (index partiel).
  begin
    insert into site_intervenants (site_id, role, company_id, main_contact_id) values (v_site, 'ELECTRICIEN', v_eec, v_paul);
    raise exception 'GARDE ECHEC — doublon actif strictement identique accepté';
  exception when unique_violation then null;
  end;

  -- Et la succession n'est PAS bloquée par une contrainte d'unicité : le lien
  -- clos (Jean) coexiste avec l'actif (Paul) — c'est la temporalité qui parle.
  select count(*) into n from site_intervenants where site_id = v_site and role = 'ELECTRICIEN';
  if n <> 2 then raise exception 'TEMPORALITE ECHEC — succession non représentable'; end if;

  raise exception 'RECETTE_OK — les 10 scénarios passent, transaction annulée, rien ne persiste';
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
    console.log('✅ RECETTE MODÈLE P0-3 : les 10 scénarios passent (transaction annulée, zéro persistance)')
  } else {
    console.error('❌ RECETTE EN ÉCHEC :')
    console.error(text)
    process.exit(1)
  }
}

main()
