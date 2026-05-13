# Modèle de données

Types TypeScript dans `types/db.ts`. Migrations dans `supabase/migrations/`. RLS sur toutes les tables.

---

## Utilisateurs

### `users`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| email | text | unique |
| full_name | text | nullable |
| role | enum | `admin \| manager \| chef_equipe` |
| must_change_password | boolean | forcé après reset admin |
| phone | text | E.164, nullable (migration 035) |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

---

## AO (Appels d'offres)

### `tenders`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| client_name | text | nullable |
| deadline | date | nullable |
| status | enum | `draft \| extracting \| analyzing \| ready \| failed \| submitted \| archived` |
| opportunity_score | numeric | nullable |
| outcome | enum | `pending \| won \| lost \| withdrawn \| not_responded` |
| outcome_at / reason / tag / set_by | — | mémoire commerciale |
| voice_note_path | text | bucket `tender-voice-notes` |
| voice_note_duration_seconds | int | |
| created_by | uuid FK users | |
| deleted_at | timestamptz | |

### `tender_documents`
PDF uploadé par le manager. `extracted_text` rempli après extraction.

### `tender_analyses`
Résultat de l'analyse IA : `summary`, `constraints[]`, `risks[]`, `checklist[]`, `technical_memo`.

### `tender_chat_messages`
Messages Atelier IA. `agent_name` nullable (messages user = null).

### `agent_analyses`
Analyses parallèles par agent. `status: pending | running | ready | failed`.

### `tender_memory` (tender_memory_entries)
Journal mémoire commercial par AO. Entrées libres texte.

---

## Contrats & Engagements

### `contracts`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tender_id | uuid FK | nullable (contrat hors AO possible) |
| name | text | |
| client_name | text | |
| start_date / end_date | date | |
| status | enum | `active \| paused \| terminated \| archived` |
| created_by | uuid FK users | |

### `engagements`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tender_id | uuid FK | |
| contract_id | uuid FK | nullable (null = phase curation) |
| source_type | enum | `ao_clause \| memoire_engagement \| manual` |
| source_excerpt | text | extrait source brut |
| source_ref | jsonb | métadonnées (ex: raison archivage) |
| category | enum | `frequency \| quality \| compliance \| delivery \| sla \| reporting \| other` |
| short_label | text | label court curé |
| measurable | boolean | |
| ai_confidence | numeric | 0-1, nullable |
| status | enum | `extracted \| curated \| active \| completed \| archived` |
| created_by | uuid FK users | |

---

## Terrain (Field)

### `clients`
Entité client. Liée aux sites.

### `sites`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK | |
| contract_id | uuid FK | nullable |
| name | text | |
| address | text | |
| access_code / alarm_code | text | fiche site (migration 036) |
| contact_name / contact_phone | text | |
| access_hours / access_instructions | text | |
| deleted_at | timestamptz | |

### `site_notes`
Notes courtes (140 chars max) par site. Verrou V4 doctrine : format descriptif passif uniquement.

### `missions`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| site_id | uuid FK | |
| name | text | |
| cadence | enum | `daily \| weekly \| biweekly \| monthly \| on_demand` |
| default_team | text[] | noms (legacy) |
| engagement_ids | uuid[] | engagements liés (clé de la boucle AO↔Field) |
| default_checklist | jsonb[] | items template |
| assigned_team_id | uuid FK teams | nullable |
| active | boolean | |

### `intervention_templates`
Templates de récurrence. `frequency: daily|weekdays|weekly|monthly|one_shot`. Génération paresseuse à 7j.

### `interventions`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| mission_id | uuid FK | |
| scheduled_at | timestamptz | |
| scheduled_for | date | date ISO (récurrence) |
| slot | enum | `morning \| afternoon \| evening` |
| template_id | uuid FK | nullable |
| team | text[] | noms membres (legacy) |
| assigned_team_id | uuid FK teams | nullable |
| status | enum | `planned \| in_progress \| completed \| validated \| skipped` |
| executed_at | timestamptz | |
| skipped_at / skipped_reason / skipped_by | — | |

### `intervention_checklist_items`
Items checklist liés à un engagement (`engagement_id` nullable).

### `intervention_photos`
| Colonne | Type | Notes |
|---|---|---|
| kind | enum | `before \| after \| anomaly \| proof` |
| storage_path | text | bucket Supabase Storage |
| taken_at | timestamptz | |

### `intervention_anomalies`
| Colonne | Type | Notes |
|---|---|---|
| category | enum | `eau_coupee \| materiel_casse \| acces_bloque \| produit_manquant \| autre` |
| status | enum | `open \| resolved \| ignored` |
| resolved_at / resolution_note | — | |

### `intervention_validations`
Validation chef d'équipe ou manager. `validated_by` + `validated_at` + `comment`.

### `intervention_participants`
Membres présents à l'intervention (doctrine V2 : couverture, pas surveillance).

---

## Équipes

### `teams`
`name`, `color`, `referent_user_id` (FK users), `active`, `deleted_at`.

### `team_members`
`team_id`, `user_id`, `joined_at`, `left_at`. `left_at IS NULL` = membre actif.

---

## Preuves & Partage

### `proof_share_tokens`
Token signé pour partage public. `expires_at`, `intervention_id`. Champ `report_type` pour les rapports mensuels.

### `proof_verification_tokens` (migration 032)
Tokens QR code de vérification d'authenticité.

### `monthly_reports`
Rapport mensuel par contrat et mois. Contenu markdown.

---

## Connaissances & Logs

### `knowledge_items`
Base de connaissances. `category: references_clients | moyens_humains | materiel | procedures | qualite | anciens_memoires`. Tags libres.

### `activity_logs` (= `audit_log`)
Log de toutes les mutations admin. `entity_type`, `entity_id`, `action`, `metadata` jsonb, `user_id`.

### `ai_usage`
Tracking tokens IA : provider, model, prompt_tokens, completion_tokens, cost.

---

## Buckets Supabase Storage

| Bucket | Usage |
|---|---|
| `intervention-photos` | Photos terrain |
| `tender-documents` | PDF AO uploadés |
| `tender-voice-notes` | Notes vocales DG |
| `knowledge-files` | Fichiers bibliothèque |

---

## Règles clés

- **Soft delete** : `deleted_at IS NOT NULL` = supprimé. Jamais de DELETE physique sur les entités métier.
- **`engagement_ids[]`** sur missions : relation many-to-many entre missions et engagements, stockée côté mission pour simplifier les requêtes de compliance.
- **Pas de `assigned_to` sur interventions** : doctrine V2, on affecte des équipes pas des individus.
- **Format E.164** sur `users.phone` : validé par CHECK constraint DB + Zod côté server action.
