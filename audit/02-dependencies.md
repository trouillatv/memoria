# 02 — Cartographie des dépendances (FK entrantes)

> Audit 2026-07-13 — exhaustif : toutes les FK du schéma sont déclarées inline
> (`references …`) ; les `ADD CONSTRAINT` sont tous des CHECK. Source : les 194
> migrations `001`→`196`.

## clients

```
clients
├── sites.client_id ................. CASCADE   003:19   ⚠ point d'entrée de la chaîne destructrice
└── dossiers.client_id .............. SET NULL  172:28
```

## sites

```
sites
├── missions.site_id ................ RESTRICT  004:5    ⛔ BLOQUE le DELETE (même mission soft-deletée)
├── site_reports.site_id ............ CASCADE   099:30
├── visit_capture.site_id ........... CASCADE   165:43
├── visit_watchlist.site_id ......... CASCADE   196:23
├── site_notes / site_day_log / site_delivery / site_reserve /
│   site_decisions / site_intervenants / site_obligation /
│   site_blocages / site_morning_digest / subjects / dossiers /
│   memory_scopes / captured_knowledge / trace_embeddings /
│   site_reading_candidates / intervention_voice_notes /
│   report_sites / action_distributions / dossier_phase_events
│   .............................. CASCADE   (033,108,109,110,136,137,146,160,191,124,172,117,170,052,055,056,101,148,187)
└── handover_briefs / report_documents / memory_correction_events
    .............................. SET NULL  (079:35, 120:24, 139:19)
```

## site_reports (visites ET réunions)

```
site_reports
├── PRÉSERVÉS (SET NULL) : site_actions (099:150), site_decisions (136:19),
│   site_blocages.source_report_id (160:37), action_distributions (148:28),
│   intervenants.source_report_id (138:18)
└── DÉTRUITS (CASCADE) : site_report_attachments (099:79), visit_capture (165:46),
    visit_watchlist (196:22), report_photos (133:16), report_final_versions (127:14),
    document_diffs (128:18), report_photo_meta / report_cr_meta (129),
    report_human_points (130), report_point_actions (132), report_added_points (134),
    pv_signal_decisions (125:17), report_sites (101:39), report_documents (120:22),
    memory_correction_events (139:18), report_analysis_runs (142:14),
    site_report_proposals (099:103)
```

Le hard delete réunion existant (`deleteMeetingAction`) est cohérent avec ça : il
détache les actions AVANT le DELETE, la cascade emporte le reste (métadonnées de CR).

## missions

```
missions
├── interventions.mission_id ........ CASCADE   018:66   ⚠⚠ voir « chaînes profondes »
├── intervention_templates .......... CASCADE   021:27
├── mission_checklist_items ......... CASCADE   004:27
├── mission_photos .................. CASCADE   004:39
├── incidents ....................... CASCADE   004:51
└── reports (UNIQUE) ................ CASCADE   006:5
```

## interventions

```
interventions — TOUT est en CASCADE :
├── intervention_photos ............. CASCADE   018:104  ⚠ PREUVES — aucune colonne de cycle de vie
├── intervention_validations ........ CASCADE   018:143  ⚠ signatures
├── intervention_anomalies .......... CASCADE   018:122
├── intervention_checklist_items .... CASCADE   018:104
├── intervention_voice_notes ........ CASCADE   056:30
├── intervention_participants ....... CASCADE   024:37
├── intervention_companies .......... CASCADE   091:24
├── proof_share_tokens .............. CASCADE   022:17
├── proof_verification_tokens ....... CASCADE   032:24
├── intervention_access_events ...... CASCADE   070:31
└── intervention_tokens ............. CASCADE   097:22
```

## teams

```
teams
├── team_members .................... CASCADE   023:56
├── interventions.assigned_team_id .. SET NULL  023:85   (opérationnel préservé)
├── missions.assigned_team_id ....... SET NULL  023:88
└── handover_briefs source/target ... SET NULL  079:32-33
```

## contracts

```
contracts
├── sites.contract_id ............... SET NULL  018:26
├── engagements ..................... SET NULL  017:47
├── site_reports.contract_id ........ SET NULL  101:19
└── proof_share/verification_tokens . CASCADE   026:18, 032:25
```

## users (FK CASCADE uniquement — risque de perte)

```
users
├── public.users.id → auth.users .... CASCADE   002:4    (suppression compte auth ⇒ ligne user)
├── team_members.user_id ............ CASCADE   023:57
├── intervention_participants ....... CASCADE   024:39
├── feedback.user_id ................ CASCADE   075:16
└── notifications.user_id ........... CASCADE   159:16
```

Toutes les autres références (`created_by`, `taken_by`, `validated_by`, `decided_by`…
— des dizaines) sont en SET NULL : les enregistrements survivent, l'imputation se perd.

## ⚠ Chaînes CASCADE profondes (destruction de preuves)

1. **`DELETE missions` → interventions → photos/signatures/vocaux.** La plus
   dangereuse : `intervention_photos` n'a NI deleted_at NI status NI archived_at
   (018:102-111) — destruction irréversible et silencieuse, exécutable par le
   service role (RLS bypassée). → C'est pourquoi la mission ne doit JAMAIS avoir de
   hard delete dès qu'une intervention existe (cf. 03-delete-strategy).
2. **`DELETE site_reports` → visit_capture + pièces.** Le soft-delete visite
   (mig 190) existe précisément pour ne pas déclencher ça.
3. **`DELETE clients` → sites → …** : cascade létale MAIS interrompue par
   `missions.site_id RESTRICT` (004:5). **La protection est un effet de bord, pas
   une conception** — ne jamais s'y fier ; c'est la couche applicative qui doit
   refuser (garde de dépendances, comme `deleteSiteAction`).

## Hétérogénéité du cycle de vie (à connaître avant tout lot « Retirer »)

| Table | deleted_at | status | Notes |
|---|---|---|---|
| clients | ✅ 003:12 | — | jamais écrit par l'app |
| sites | ✅ 003:24 | `phase` (prospect/en_ao/actif/perdu/archive, 171:19) | soft-delete livré |
| site_reports | ✅ 190:11 | draft/…/curated/archived/failed (099:34) | soft = visites seulement |
| missions | ✅ 004:18 | `active` bool (018:51) | jamais écrit |
| interventions | ❌ | planned/in_progress/completed/validated/**skipped** (018:34) — pas de `cancelled` | enum PG → migration additive pour `cancelled` |
| intervention_photos | ❌ | ❌ | append-only, AUCUNE barrière |
| site_actions | ❌ | open/planned/done/**cancelled** (099:155) | le modèle du `cancelled` existe ici |
| site_decisions | ❌ | `statut` FR : proposee/actee/appliquee/caduque/contredite (136:27) | vocabulaire divergent |
| teams | ✅ 023:31 | `active` | livré |
| contracts | ✅ 017:34 | active/paused/terminated/archived (017:13) | — |
| documents | ✅ 073:71 | active/superseded/expired/archived (073:51) | — |
| visit_capture | ❌ | captured/kept/**discarded** réversible (165:52) | « jamais DELETE » gravé |
```
