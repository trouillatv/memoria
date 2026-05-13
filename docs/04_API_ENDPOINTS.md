# API Endpoints

Ce fichier couvre les **route handlers** REST (`app/api/` et routes PDF). Les server actions (`actions.ts`) ne sont pas des endpoints HTTP au sens strict — voir `07_CARTOGRAPHIE_CODE.md`.

---

## Routes API REST (`app/api/`)

### `POST /api/tenders/[id]/analyze`
Lance l'analyse IA d'un AO.

- **Auth** : session requise (manager ou admin)
- **Body** : vide (l'ID est dans l'URL)
- **Comportement** : déclenche l'analyse en arrière-plan, retourne immédiatement `{ ok: true }`
- **Polling** : client poll `/api/tenders/[id]/status` toutes les 2s jusqu'à `status !== 'analyzing'`

### `GET /api/tenders/[id]/status`
Retourne le statut courant de l'analyse d'un AO.

- **Auth** : session requise
- **Réponse** : `{ status: TenderStatus, error_msg?: string }`

---

## Routes PDF (route handlers dans `app/`)

Ces routes génèrent un PDF à la demande côté serveur et retournent `Content-Type: application/pdf`.

### `GET /tenders/[id]/atelier-export.pdf`
Export du dossier de préparation Atelier IA.

- **Auth** : session requise (manager ou admin)
- **Contenu** : synthèse IA + analyses agents + mémoire technique
- **Visible** : uniquement si contenu IA existe (`agent_analyses` ou `tender_analyses`)

### `GET /preuves/[id]/dossier`
Dossier de preuve d'une intervention.

- **Auth** : session requise
- **Contenu** : fiche intervention, checklist, photos, anomalies, validations, QR code de vérification

### `GET /litige/dossier`
Dossier litige express multi-interventions.

- **Auth** : session requise
- **Query params** : `contract_id`, `date_from`, `date_to`
- **Contenu** : synthèse + preuves filtrées par contrat et période

### `GET /semaine/export`
Export de la vue semaine (format Excel via exceljs).

- **Auth** : session requise
- **Query params** : `week` (date ISO du lundi)

### `GET /contracts/[id]/rapport-mensuel`
(Partage du rapport mensuel via lien signé — voir proof_share_tokens avec `report_type`)

---

## Routes publiques (sans auth)

### `GET /p/[token]`
Accès public à une preuve partagée.

- **Auth** : aucune — token dans l'URL
- **Comportement** : vérifie le token dans `proof_share_tokens`, affiche la preuve si valide et non expirée

### `GET /p/[token]/pdf`
Téléchargement PDF d'une preuve partagée.

- **Auth** : aucune — même token
- **Retourne** : PDF généré à la volée

### `GET /v/[token]`
Vérification publique d'authenticité d'un dossier (QR code).

- **Auth** : aucune
- **Comportement** : affiche la date de génération, l'intervention et un statut de validité

---

## Notes

- Il n'y a **pas** d'API REST générique CRUD. Toutes les mutations passent par des **server actions** (`'use server'`).
- Les signed URLs Supabase Storage sont générées côté serveur et transmises aux composants via props — les fichiers ne sont jamais exposés directement.
