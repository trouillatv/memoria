# 04 — RLS, droits et rafraîchissement

> Audit 2026-07-13. Fait structurant, écrit dans les migrations elles-mêmes
> (038:12-15, 089:105-106, 165:89) : **les policies sont contournées par le service
> role** — 1303 usages de `createAdminClient` (274 fichiers) contre 75 du client
> RLS-aware (surtout l'auth). La sécurité réelle vit donc dans le CODE
> (rôle + garde org), la RLS est une défense en profondeur pour une éventuelle
> bascule server-client.

## Tableau RLS par table centrale

| Table | RLS | SELECT | INSERT/UPDATE/DELETE | Réellement exercée ? |
|---|---|---|---|---|
| clients | ✅ 011:33 | org + authenticated (089:112) | `FOR ALL` admin/manager (089:120) | Bypassée |
| sites | ✅ 011:47 | org + (admin/manager OU membre équipe du site) (089:153) | `FOR ALL` admin/manager (089:170) | Bypassée |
| missions | ✅ 011:61 | org + admin/manager (089:204) | `FOR ALL` admin/manager (089:213) | Bypassée |
| interventions | ✅ 018:193 | org + (admin/manager OU `auth.uid() = any(team)`) (089:226) | admin/manager + chef_equipe si dans team (019:11) + trigger column-guard (038:126) | Bypassée |
| contracts | ✅ 089:131 | org + admin/manager | `FOR ALL` admin/manager (089:139) | Bypassée |
| site_reports | ✅ 099:177 | service_role ONLY (099:182) | service_role only | Service-role par conception |
| site_actions | ✅ 099:180 | service_role only (099:188) | service_role only | idem |
| site_decisions | ✅ 136:40 | sites de l'org (SELECT seul) | AUCUNE policy write | Service-role only |
| visit_capture | ✅ 165:87 | sites de l'org (SELECT seul, 165:91) | AUCUNE policy write (165:89 explicite) | Service-role only |
| intervention_photos | ✅ 018:211 | org + (admin/manager OU membre team) (038:84) | admin/manager + chef_equipe team (019:50) | Bypassée (uploads via admin client) |
| documents | ✅ 073:111 | org + authenticated (089:265) | `FOR ALL` admin/manager (089:271) | Bypassée |

**Aucune policy `FOR DELETE` explicite dans tout le schéma** (hors 2 périphériques :
intervention_participants 024:152, intervention_companies 091:81). Les DELETE ne
passent que par les `FOR ALL` admin/manager — ou par le service role.

## Qui peut retirer/archiver quoi ? (règle applicative cible)

| Objet | Admin (plateforme) | Manager | Chef d'équipe |
|---|---|---|---|
| Visite | ✅ | ✅ (son org) | ✅ (existant : `requireFieldAgent`, debrief-actions.ts:295) |
| Réunion | ✅ | ✅ (existant : `requireManager`, meetings/actions.ts:34) | ❌ |
| Intervention (annuler/retirer) | ✅ | ✅ | ❌ (il a déjà « Signaler qu'on n'est pas passé » = skip) |
| Mission | ✅ | ✅ | ❌ |
| Client (archiver) | ✅ | ✅ | ❌ |
| Site | ✅ | ✅ (existant, avec garde de dépendances) | ❌ |

## Droits d'ÉCRITURE — état réel (audit mutations)

Bonne nouvelle : **toutes** les server actions métier vérifient le rôle
(`requireManagerOrAdmin` ou `requireFieldAgent`) — aucune n'accepte la simple
authentification.

Mauvaise nouvelle : **aucune écriture ne vérifie l'appartenance ORG de l'objet
muté.** `tenantOwns()` (lib/db/tenant.ts) n'est utilisé que sur 2 lectures (PDF
journal/réserves). IDOR d'écriture cross-org possible sur :

1. `intervention-actions.ts` — tout le cycle de vie (start/complete/checklist/
   reschedule/skip/reopen/photos/anomalies) via `getIntervention(id)` non scopé
   (lib/db/interventions.ts:206-211). **Surface la plus large.**
2. Création d'intervention (semaine + contrat) via `getMission(id)` non scopé
   (lib/db/missions.ts:38).
3. `createMissionAction` — org prise du site sans vérifier qu'il appartient au
   caller (missions/actions.ts:39-54).
4. Équipes : update/archive/addMember/removeMember via `getTeam(id)` non scopé
   (lib/db/teams.ts:87).
5. `addCompanyAction`/`removeCompanyAction` — par intervention_id brut.
6. Terrain : `startVisitAction`/`createSiteReport` par site_id brut.

Correctif type : `tenantOwns(ctx, table, id)` en tête de chaque action (admin
exempté = super-admin plateforme). C'est le **Lot S** de la roadmap.

## Cache / rafraîchissement — état réel

Convention : `revalidatePath()` dans l'action + `router.refresh()` client après
`{ok}`. Pas de React Query/SWR.

| Mutation | revalidatePath | router.refresh | Verdict |
|---|---|---|---|
| Créer mission | `/missions` (actions.ts:61) | ❌ (`NewMissionDialog.tsx:43-46`) | **Le cas « je crée, rien n'apparaît » le plus probable** |
| Créer intervention (semaine) | `/semaine` (actions.ts:521) | ✅ (:136) | OK |
| Créer intervention (contrat) | seulement `/contracts/[id]/interventions` | ✅ | OK page courante ; `/semaine`/`/missions` non revalidés (atténué : force-dynamic) |
| Créer site | `/sites` | ✅ + push | OK ; **mais le client créé inline ne revalide pas `/clients`** |
| Créer client | `/clients` | via bouton | OK |
| Créer équipe | `/equipes` | ✅ | OK |

Pages listes : `/missions`, `/semaine`, `/sites`, `/equipes` = force-dynamic ✅ ;
**`/clients` et `/m` (accueil) ne le sont pas** — plus sensibles au cache périmé.

→ **Lot R** de la roadmap : `router.refresh()` dans NewMissionDialog, revalidation
`/clients` dans createSiteGlobalAction, force-dynamic sur `/clients`, et la règle
d'or « toute action de mutation revalide TOUS les paths qui affichent l'objet ».
