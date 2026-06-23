# Modèle de données

Types TypeScript dans `types/db.ts`. Migrations dans `supabase/migrations/` (001 → 161).
RLS sur toutes les tables. **Multi-tenant** : `organization_id` partout (migration 089) — RLS scopée par org
(`current_user_org_id()`). Écritures métier via service-role (server actions) ; RLS = défense en profondeur en lecture.

> Convention : ce document liste les colonnes **clés** des entités centrales (`| Colonne | Type | Notes |`),
> et une description **d'une ligne** pour les tables secondaires. La vérité colonne par colonne est `types/db.ts`.

---

## 1. Multi-tenant & Utilisateurs

### `organizations` (migration 089)
Tenant racine du multi-tenant. `id`, `name`, `slug`, `created_at`. `organization_id` est ajouté à toutes les
tables métier par cette migration (pivot majeur). `organizations.industry_template` (mig 115) = clé du métier
(catalogue de vocabulaire paramétrable).

### `users`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| email | text | unique |
| full_name | text | nullable |
| role | enum | `admin \| manager \| chef_equipe` |
| organization_id | uuid FK | mig 089 — multi-tenant |
| must_change_password | boolean | forcé après reset admin |
| phone | text | E.164, nullable (mig 035) — coordonnée 1-à-1, jamais groupe |
| commune | text | mig 076 |
| employment_type | enum | `cdi \| cdd \| cdi_chantier`, nullable (mig 076) — structurel, jamais comparatif |
| contract_end_date | date | mig 081 — sujet = mémoire opérationnelle, jamais valeur de la personne |
| theme_preference | text | mig 084 |
| home_preference | enum | `dashboard \| terrain` (mig 093) |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

---

## 2. AO (Appels d'offres)

### `tenders`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| client_name | text | nullable |
| deadline | date | nullable |
| status | enum | `draft \| extracting \| analyzing \| ready \| failed \| submitted \| archived` |
| opportunity_score | numeric | nullable |
| outcome / outcome_at / outcome_reason / outcome_tag / outcome_set_by | — | mémoire commerciale (mig 029), `outcome_tag ∈ prix\|qualite\|relation\|timing\|autre` |
| voice_note_path / _duration_seconds / _recorded_at / _recorded_by | — | note vocale DG (mig 031), bucket `tender-voice-notes` |
| created_by | uuid FK users | |
| deleted_at | timestamptz | |

### `tender_documents`
PDF uploadé. `storage_path`, `filename`, `extracted_text` (rempli après extraction), `extraction_source` (mig 057 : `native|ocr`).

### `tender_analyses`
Résultat de l'analyse IA : `summary`, `constraints[]`, `risks[]`, `checklist[]`, `technical_memo`, `provider`, `model`.
`document_sources[]` (mig 074) = références `[doc:id]` tracées (jamais le texte).

### `tender_conversations` / `tender_chat_messages` / `tender_chat_attachments`
Atelier IA (mig 014, 063). Conversations nommées + messages (`role` user/agent/system, `agent_name` nullable) + pièces jointes.

### `agent_analyses` (migration 015)
Analyses parallèles par agent (`general | lecteur_ao | memoire_technique | contradicteur | financier | terrain | conformite`).
`status: pending | running | ready | failed`, `summary`, `key_points` (jsonb), `raw_content`.

### `engagements`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tender_id | uuid FK | |
| contract_id | uuid FK | nullable (null = phase curation) |
| source_type | enum | `ao_clause \| memoire_engagement \| manual` |
| source_excerpt | text | extrait source brut |
| category | enum | `frequency \| quality \| compliance \| delivery \| sla \| reporting \| other` |
| kind | enum | `objectif \| obligation \| livrable \| controle \| penalite`, nullable (mig 153 — nature prescriptive) |
| short_label | text | label court curé |
| measurable | boolean | |
| ai_confidence | numeric | 0-1, nullable |
| status | enum | `extracted \| curated \| active \| completed \| archived` |
| proof_requirement | enum | `photo \| anomaly_documented \| none` (mig 046) |
| destination | enum | `contract_engagement \| vigilance \| a_savoir \| mission` (mig 083) |
| created_by | uuid FK users | |

`engagement_similarity` (mig 020) : matching cross-AO (réutilisation d'expérience).

---

## 3. Contrats

### `contracts`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tender_id | uuid FK | nullable (contrat hors AO possible) |
| name / client_name | text | |
| start_date / end_date | date | |
| status | enum | `active \| paused \| terminated \| archived` |
| volume_horaire_mensuel | numeric | nullable (V6.3) — cible du contrat, jamais par personne |
| frequence | text | nullable (V6.3) — rythme contractuel libellé |
| created_by | uuid FK users | |
| deleted_at | timestamptz | |

`monthly_reports` : rapport mensuel par contrat et mois (markdown). `tender_similarity` (mig 030) : voisinage AO.

---

## 4. Sites & terrain

### `clients`
Entité client, liée aux sites.

### `sites`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| contract_id | uuid FK | nullable |
| name / address | text | |
| access_code / alarm_code | text | fiche site (mig 036) |
| contact_name / contact_phone | text | |
| access_hours / access_instructions | text | |
| requires_access_handover | boolean | mig 070 — site avec remise de clés/badges |
| latitude / longitude | double precision | mig 161 — coordonnées pour la météo Open-Meteo, saisie manuelle opposable |
| deleted_at | timestamptz | soft delete |

### `site_notes` (mig 033, 045)
Notes courtes (140 chars max) par site, descriptif passif. `kind: note | a_savoir` ; `a_savoir` peut porter `active_until`.

### `missions`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| name | text | |
| cadence | enum | `daily \| weekly \| biweekly \| monthly \| on_demand` |
| engagement_ids | uuid[] | engagements liés (clé de la boucle AO↔Field) |
| default_checklist | jsonb[] | items template (`expected_qty` mig 111 = item « à quantité ») |
| assigned_team_id | uuid FK teams | nullable |
| active | boolean | |
| deleted_at | timestamptz | |

### `intervention_templates` (mig 021, 085)
Templates de récurrence. `frequency: daily|weekdays|weekly|monthly|one_shot`, créneaux, `planned_start_hhmm/_end_hhmm` (mig 085). Génération paresseuse.

### `interventions`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| mission_id | uuid FK | |
| scheduled_at / scheduled_for | timestamptz / date | |
| slot | enum | `morning \| afternoon \| evening` |
| template_id | uuid FK | nullable |
| team | text[] | noms membres (legacy) ; `assigned_team_id` = équipe (doctrine V2) |
| status | enum | `planned \| in_progress \| completed \| validated \| skipped` |
| executed_at | timestamptz | |
| planned_start / planned_end | timestamptz | V6.1 (mig 071) — ancrage prestation, jamais pointage personne |
| skipped_at / skipped_reason / skipped_by | — | |

**Enfants d'intervention :**
- `intervention_checklist_items` : items liés à un engagement (`engagement_id` nullable). `expected_qty/delivered_qty/item_status` (mig 111). `executed_by_token_id` (mig 106) = contribution externe scopée.
- `intervention_photos` : `kind: before | after | anomaly | proof | passage | access`. Intégrité crypto (mig 040) : `sha256`, `mime_type`, `client_timestamp`, `hash_origin`. `ai_caption` (mig 067).
- `intervention_anomalies` : `category` BTP étendue (mig 094 : `eau_coupee | electricite_coupee | materiel_casse | acces_bloque | produit_manquant | zone_non_prete | danger_securite | livraison_probleme | autre`), `status: open | resolved | ignored`, `scope_id` (mig 118), `subject_id` (mig 144).
- `intervention_validations` : `validated_by`, `validated_at`, `comment`.
- `intervention_participants` (mig 024) : présents (doctrine V2 — couverture, pas surveillance).
- `intervention_access_events` (mig 070) : preuve d'accès (prise / restitution / incident), pas un registre de détention.
- `intervention_companies` (mig 091) : entreprises externes (sous-traitants/fournisseurs) sur l'intervention, jamais des individus.

### `teams` / `team_members`
`teams` (mig 023) : conteneur logistique de couverture (jamais unité analytique — pas de score/capacité). `icon` (mig 077), `specialties[]` (mig 078), `referent_user_id` (mig 025). `team_members` : `joined_at` / `left_at` (`left_at IS NULL` = actif).

### `handover_briefs` (mig 079)
Passage de témoin (snapshot JSONB immuable `payload`). `kind: member_change | team_takes_site | manual`, `effective_date` (mig 088), token de partage + accusé de réception. Sujet = mémoire du lieu, jamais évaluation de personne.

---

## 5. Réunions / Compte-rendu (pivot « réunion de chantier → CR/PV »)

### `site_reports` (migration 099 — pivot majeur)
Compte-rendu multimodal : le terrain produit (voix + texte + photos + pièces) → l'IA propose → l'humain valide. **L'artefact brut n'est jamais supprimé**, même si l'IA échoue.

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | enum | `contract \| site \| free` (réunion contrat multisite, mig 101) |
| site_id / contract_id | uuid FK | selon le type |
| title | text | nullable |
| organization_id | uuid FK | multi-tenant |
| status | enum | `draft \| transcribing \| ready \| analyzing \| proposed \| curated \| archived \| failed` |
| audio_path / audio_mime / audio_duration_seconds | — | audio principal |
| transcript_raw / transcript_corrected | text | |
| transcript_status | enum | `none \| pending \| done \| failed` |
| text_input | text | saisie texte alternative |
| participants | jsonb[] | `{ name, role, kind, presence(P/AE/AN), invite, diffusion, contactId }` |
| risks | jsonb[] | `{ kind(dependency/preparation/vigilance/risk), label, waiting_party, awaited }` |
| next_meeting_at | timestamptz | mig 131 |
| estimated_duration_minutes | int | mig 141 — durée prévue (indice de couverture) |
| created_by / created_at / updated_at | — | |

**Tables liées au CR :**
- `site_report_attachments` : pièces (`kind: audio | photo | file`), `sha256`, `client_uuid` (idempotence offline). **Audio multi-sources** (mig 141) : `label`, `type_source` (`audio_meeting | voice_note | phone_call | debrief | other`), `transcript_raw/_status`, `source_weight`.
- `site_report_proposals` : DÉCISION détectée routée par nature (`action | intervention | mission | anomaly | vigilance | note | proof_request | client_memory`), `status: proposed | accepted | rejected`, `subject_id` (mig 124), `origin: initial | reanalysis` (mig 142). Ce qui est décidé ≠ ce qui est exécuté.
- `report_documents` (mig 120) : document généré depuis la réunion (PV/CR). `template_key`, `sections` (jsonb, source de vérité, `kind: generative | fixed`), `status: draft | validated | exported`, `final_document_id`/`final_path` (mig 126 — version diffusée), `pdf_path`.
- `report_final_versions` (mig 127) : **versions empilées** de la version finale diffusée (preuve, jamais écrasée). `version_no`, `path`, `format: pdf | docx`, `note` (diffusion).
- `report_human_points` (mig 130) : remarque texte libre humaine rattachée à une `section` (`ordre_du_jour | points_examines | avancement | previsions | securite`). Ajout, pas correction.
- `report_added_points` (mig 134) : point STRUCTURÉ ajouté en séance, `kind: anomalie | prevision`, `label`, `statut`, `due_date`, `assigned_to`. `subject_id` (mig 144). Ajout éditorial → vraie suppression autorisée.
- `report_point_actions` (mig 132) : colonne ACTION des points examinés, `point_source` + `codes[]` (ETV/MOA/MOE/FSH/CLUB). Stocké dans la mémoire, pas seulement le PDF.
- `report_photos` (mig 133) : photo ajoutée directement au CR (ajout éditorial, vraie suppression OK — ≠ artefact terrain). Bucket `intervention-photos`, préfixe `report/<reportId>/`.
- `pv_signal_decisions` (mig 125) : décision humaine auditable sur un signal de validation PV. `signal_id`, `statut: reported | ignored | false_positive`. Une décision par signal (upsert).
- `report_analysis_runs` (mig 142) : historique léger des ré-analyses (`trigger: initial | reanalysis`, `source_count`, `delta` jsonb). Ré-analyse non destructive.
- `document_diffs` (mig 128) : fondation d'apprentissage — lie version générée ↔ version finale (`summary` jsonb, VIDE aujourd'hui). Jamais d'apprentissage automatique.
- `memory_correction_events` (mig 139) : capture passive des corrections humaines (grain = l'édition). `entity`, `field`, `category`, `op: added | edited | removed`, `before_val`/`after_val`. Matière d'entraînement non reconstituable, best-effort.

---

## 6. Objets métier du chantier

### `site_actions` (migration 099 — nouvel objet central)
Une réunion produit d'abord des **actions ouvertes** ; seules certaines deviennent des interventions planifiées.

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| report_id | uuid FK | nullable (CR d'origine) |
| title / body | text | |
| corps_etat | text | regroupement par corps d'état, nullable |
| assigned_to | text | nullable (texte libre, jamais nominatif interne) |
| status | enum | `open \| planned \| done \| cancelled` |
| due_date / due_date_status | date / enum | `explicit \| estimated \| null` (mig 121) |
| kind | enum | `one_shot \| deadline \| recurring_until_done` (mig 149) |
| converted_to_type / _id | — | si convertie en intervention |
| completed_comment / completed_photo_path | — | clôture avec trace (mig 107) |
| scope_id | uuid FK | sous-périmètre (mig 117), nullable |
| reserve_id | uuid FK | action corrective d'une réserve (mig 123), nullable |
| subject_id | uuid FK | sujet vivant (mig 124), nullable |
| ext_status / ext_comment / ext_photo_path / ext_at / ext_by | — | déclaration externe via `action_distributions` (mig 148). ÉCHO terrain, ne pilote jamais `status` |
| created_from | text | provenance (mig 112), observabilité, jamais affiché |

### `site_reserve` (migration 110)
Réserves de réception (OPR / PV) dressées par la MOE, à **LEVER** une à une avec preuve et date.

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | site-scoped (pas intervention) |
| label | text | ex. « fissure mur axe 4 » |
| location | text | zone / ouvrage |
| issued_by / issued_on | text / date | émetteur (MOE…) + date d'émission |
| status | enum | `open \| lifted` — **« levée », jamais « résolu »** (vocabulaire juridique) |
| photo_before_path / photo_after_path | text | preuve avant / après |
| lifted_at / lift_note | timestamptz / text | levée datée opposable |

`reserve_links` (mig 123) : liens d'une réserve vers documents / actions correctives.

### `site_decisions` (migration 136)
« On a décidé que… » — l'objet le plus DURABLE d'un CR (mémoire du SITE, ≠ ajout éditorial).

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| report_id | uuid FK | CR d'origine, nullable |
| titre / description | text | |
| sujet | text | clé de cluster (contradiction / récurrence / recherche) |
| decisionnaire_role / decisionnaire_org | text | MOA/MOE/ETV/FSH/CLUB ; organisme |
| date_decision / echeance | date | |
| statut | enum | `proposee \| actee \| appliquee \| caduque \| contredite` |
| impact | enum | `planning \| cout \| technique \| securite \| autre`, nullable |
| confiance | enum | `sûr \| à confirmer` |
| source | enum | `meeting \| transcript \| human` |
| action_id | uuid FK | mig 137 — décision → action |

### `site_blocages` (migration 160)
Blocage = événement daté qui empêche d'avancer. Mémoire de contexte opposable — PAS du planning, PAS un Gantt.

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| subject_id | uuid FK | s'accroche au sujet, nullable |
| type | enum | `intemperie \| greve \| acces \| livraison \| materiel \| sous_traitant \| administratif \| securite \| autre` |
| title | text | 1-200 chars |
| description / impact | text | descriptif, jamais un score / % / imputation |
| date_start / date_end | date | `date_end` null = encore en cours |
| source_type | enum | `human \| meeting \| detected` |
| source_report_id | uuid FK | CR d'origine, nullable |
| **day_log_id** | uuid FK | **POINTE vers `site_day_log`** — un blocage météo ne recopie JAMAIS la météo (1 seule source, mig 108) |

### `subjects` (migration 124)
Sujet vivant = « l'histoire complète d'un problème » (« le DOE », « la fissure »). Fil persistant qui agrège dans le temps actions/réserves/décisions/documents. **JAMAIS une personne.**

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| site_id | uuid FK | |
| scope_id | uuid FK | sous-périmètre, nullable |
| name | text | |
| status | enum | `open \| dormant \| closed` |

`subject_relation` (mig 145) : dépendance dirigée `from BLOQUE to`, `reason` obligatoire, `importance: critique | normal`. « dépend de » / « attend » = la même arête lue à l'envers. Acte humain (l'IA suggère, ne crée pas).

### `site_obligation` + `obligation_template` (migration 146 — objet PRESCRIPTIF)
Action/Réserve/Décision/Sujet sont DESCRIPTIFS ; l'obligation est PRESCRIPTIVE : elle doit exister dès le démarrage et **son absence est le signal**.

`obligation_template` (catalogue curé, standard VRD système + ajouts org) : `code`, `label`, `trigger: kickoff | phase | manual`, `closure: on_artifact | at_reception | recurring_until_reception`, `verification_kind: document | photo_journal | control_event`, `verification_param` (jsonb), `themes[]`, `importance` (mig 147).

`site_obligation` (instance d'un chantier) :
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| template_id | uuid FK | nullable |
| label | text | |
| responsible_role / responsible_contact_id | text / uuid FK | descriptif, jamais une note d'acteur |
| status | enum | `a_produire \| en_cours \| satisfaite \| non_applicable` — « négligée » = santé DÉRIVÉE, pas un statut |
| trigger / phase_key / closure / verification_kind / verification_param | — | recopiés du template |
| subject_id | uuid FK | pont sujet vivant, nullable |
| satisfied_at / satisfied_note | — | |
| importance / last_reminded_at | — | mig 147 |
| origin_tender_id / origin_engagement_id / origin_excerpt / origin_ref / origin_date | — | provenance documentaire AO→chantier (mig 154-156) |

`site_delivery` (mig 109) : bon de livraison (BL) daté et opposable. `delivered_on`, `supplier`, `material`, `quantity`, `photo_path`.

---

## 7. Casting (qui est qui, migration 137)

Graphe normalisé `RÔLE (sur ce site) → ORGANISME → CONTACT`. Le rôle vit dans le **lien** site↔entreprise.

- `companies` : organismes intervenants réutilisables dans l'org. `name`, `short_name`, `logo_url`, `siret`, adresse, contacts. (Branding documentaire exclu — futur `organization_branding`.)
- `company_contacts` : personnes d'une entreprise. `full_name`, `function`, `email`, `phone`, `mobile`, `is_main`.
- `site_intervenants` : casting PAR SITE — `role` (ETV/MOA/MOE/BET/FSH/CLUB…, libre), `company_id`, `main_contact_id`. Co-traitance possible (N entreprises par rôle).

---

## 8. Météo (journal de chantier)

### `site_day_log` (migration 108, enrichie 161)
Une entrée par site et par jour : météo + intempérie + note. Daté, opposable (preuve anti-pénalités). `UNIQUE (site_id, log_date)`.

| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| log_date | date | |
| weather | enum | `clear \| cloudy \| rain \| heavy_rain \| wind \| storm \| heat \| other` |
| intemperie | boolean | toujours une **décision humaine**, jamais dérivée auto de la météo |
| note | text | |
| precipitation_mm / wind_max_kmh / temp_min / temp_max | numeric | mig 161 — métriques Open-Meteo (NULL = non récupéré) |
| weather_source / weather_fetched_at | text / timestamptz | `open-meteo` ou null (saisie manuelle) |

> La météo DOCUMENTE, elle ne crée jamais un blocage (cf. doctrine « jamais lecture automatique »). `site_blocages.day_log_id` pointe ici.

---

## 9. Mémoire & IA

### `trace_embeddings` (mig 052, redimensionné 053)
Embeddings vectoriels (`vector(768)`, Google text-embedding-004) des traces textuelles (captions / anomalies / notes), scopés par site. RPC `find_similar_traces`.

### `knowledge_items` (mig 007) / `knowledge_chunks` (mig 060)
`knowledge_items` : bibliothèque (`category: references_clients | moyens_humains | materiel | procedures | qualite | anciens_memoires`), tags. `knowledge_chunks` : mémoire sémantique (`source_domain: library | tender_history`, `embedding vector(768)`, `chunk_text`, `metadata`).

### `memory_scopes` (mig 117)
Nœuds de mémoire = sous-périmètres interrogeables d'un site (arbre récursif via `parent_scope_id`). `scope_type_key`, `label`. Précision déterministe AVANT l'IA.

### `org_catalog` (mig 115)
Vocabulaire paramétrable par organisation : `kind`, `key`, `label`, `sort_order`, `metadata` (jsonb). Adossé à `organizations.industry_template`.

### `glossary_terms` (mig 150, 152)
Glossaire métier par organisation : `term`, `definition`, `aliases[]`, `category` (engin/matériau/document…). Référentiel manuel, admin-only.

### `ai_usage` (mig 008)
Tracking coût IA : `feature`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`. Source de prix unique ; affichage en XPF.

### `usage_events` (mig 113)
Instrumentation d'usage produit (≠ audit sécurité), best-effort : `event`, `site_id`, `user_id`, `meta` (jsonb).

---

## 10. Preuves & partage

- `proof_share_tokens` (mig 022) : partage temporaire d'un dossier de preuves. `expires_at` obligatoire, `include_identities` (anonymisation par défaut), `report_type` (mensuel, mig 026), `access_count`.
- `proof_verification_tokens` (mig 032) : token PERMANENT de vérification d'authenticité via `/v/[token]` (XOR `intervention_id` | `contract_id`+`report_month`).
- `intervention_tokens` (mig 097, 098, 105) : lien sécurisé `/i/[token]` vers une intervention (sans login). `permissions[]`, `recipient_label`, `signature_data_url` + `signed_at` (mig 105), `revoked_at`. `intervention_token_items` (mig 106) = périmètre scopé.
- `site_access_tokens` (mig 092) : QR public par site (journal lecture seule), révocable. `token`, `purpose`, `access_count`, `expires_at`.
- `action_distributions` + `action_distribution_items` (mig 148) : lot d'actions confié à une entreprise via lien/QR, avec déclaration-preuve (`declared_status: pending | done | blocked`, `declared_photo_path`, `signature_data_url`). Alimente `site_actions.ext_*`.
- `qr_access_log` (mig 096) : journal par scan QR (sans IP — RGPD). `token_id`, `scanned_at`, `user_agent`.

---

## 11. Documents génériques (migration 073)

### `documents`
Architecture documentaire unifiée. `document_type` (`contrat | avenant | procedure | protocole | plan_acces | securite | ao | memoire_technique | reference | litige | facture | preuve | autre`), `visibility_level` (`admin_only | manager | operations | field | client_portal`), `status` (`active | superseded | expired | archived`), `analysis_status`, `memory_tier` (`vivante | consultable | froide`, mig 082), `supersedes_document_id`, `effective_date`/`expires_date`, `extracted_text`, `content_hash`.

> **Litige** : `document_type = 'litige'` n'est jamais source d'une lecture/résonance/citation automatique.

### `document_collections`
Regroupement de documents (`name`, `scope_type`, `scope_id`, `position`).

### `document_links`
Rattachement polymorphe : `target_type` (`contract | site | tender | client | intervention | team | tenant | reserve | subject | obligation`), `target_id`, `reference_label` (mig 151 — saisie humaine, ex. « CCTP chapitre 4.2 »).

---

## 12. Notifications & feedback

- `notifications` (mig 159) : socle générique. `type` (1 type aujourd'hui : `feedback_reply`), `title`, `body`, `link`, `dedupe_key`, `read_at`. Tout nouveau type passe la « discipline d'apparition ».
- `user_feed_state` (mig 157) : dernière consultation du fil « Nouveau depuis hier » par utilisateur (`last_seen_at`).
- `feedback` (mig 075) : feedback in-app. `message`, `page`, `status: open | done | spam`. Réponse équipe (mig 158) : `admin_reply`, `admin_reply_at`, `admin_reply_by`, `reply_seen_at`. `feedback_attachments` (mig 095).

---

## 13. Logs

### `activity_logs` (= audit, mig 009)
Audit trail des mutations sensibles : `user_id`, `entity_type`, `entity_id`, `action`, `metadata` (jsonb), `created_at`.

---

## Buckets Supabase Storage

| Bucket | Usage |
|---|---|
| `intervention-photos` | Photos terrain, réserves (avant/après), photos & preuves de CR (préfixe `report/`) |
| `tender-documents` | PDF AO uploadés |
| `tender-voice-notes` | Notes vocales DG (AO finalisés) |
| `knowledge-files` | Fichiers bibliothèque |
| `site-report-audio` | Audios de réunion / mémos / débriefs (multi-sources) |
| `documents` | Documents génériques (architecture mig 073) |

---

## Règles clés

- **Multi-tenant** : `organization_id` partout (mig 089). RLS scopée par org via `current_user_org_id()` ; écritures via service-role (server actions), RLS = défense en profondeur en lecture.
- **Soft delete** : `deleted_at IS NOT NULL` = supprimé. Jamais de DELETE physique sur les entités métier. Exception assumée : ajouts éditoriaux d'un CR (`report_photos`, `report_added_points`) — vraie suppression autorisée car ce ne sont pas des artefacts terrain.
- **Artefact brut jamais supprimé** : un `site_report` et ses pièces survivent même si l'IA échoue. Une photo/anomalie d'intervention est au plus « exclue du PV » (réversible), jamais effacée.
- **IA propose / humain valide** : `site_report_proposals`, obligations, points — l'IA suggère, l'humain coche/curate. Jamais d'écriture métier autonome.
- **Décidé ≠ exécuté** : une décision (`site_actions`/`site_decisions`/proposals) n'est pas une intervention/mission.
- **Réserve « levée », jamais « résolu »** : `site_reserve.status = lifted` (vocabulaire juridique).
- **Météo découplée du blocage** : `site_day_log` est l'unique source météo ; `site_blocages.day_log_id` POINTE vers elle, ne la recopie pas. La météo documente, ne crée jamais un blocage. `intemperie` reste une décision humaine.
- **Obligation = objet prescriptif** : l'absence/négligence est le signal (santé dérivée `ok | négligée`, jamais stockée).
- **Sujet ≠ personne** : `subjects` et `subject_relation` portent l'histoire d'un problème, jamais une mesure d'humain. Pas de score, pas de classement par acteur ; `assigned_to` reste texte libre, jamais nominatif interne.
- **`engagement_ids[]`** sur `missions` : relation many-to-many missions↔engagements stockée côté mission (compliance simplifiée).
- **Pas de `assigned_to` individuel sur interventions** : doctrine V2, on affecte des équipes pas des individus.
- **Litige non lu automatiquement** : `documents.document_type = 'litige'` jamais source d'une lecture/résonance/citation IA.
