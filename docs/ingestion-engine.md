# Moteur d'ingestion + session de visite (conception)

> Objectif produit : **une seule chaîne**, deux portes. La visite en direct et
> l'import WhatsApp doivent aboutir **exactement au même écran de tri**. On
> n'investit pas dans « un import WhatsApp » : on investit dans **un moteur
> d'ingestion universel** dont le ZIP WhatsApp est le **premier adaptateur**.
>
> Ce document fige trois décisions AVANT d'écrire du code : (1) le **contrat
> d'entrée**, (2) le **parcours** qui converge vers le tri existant, (3) la
> **session de visite** — la brique qui répond à « ces médias, une visite ou
> deux ? ». La session sert dans TOUS les cas (direct, ZIP, partage, WhatsApp
> Business), pas seulement à l'import.

## 0. Ce qui existe déjà (pour ne pas réinventer)

- **Une visite = un `site_report`** (`origin` non-null, `started_at`, `ended_at`).
  `createVisit` / `endVisit` / `reopenVisit`. Une visite « en cours » = `ended_at IS NULL`.
- **Une capture = une ligne `visit_capture`** (`report_id`, `site_id`, `dossier_id`,
  `organization_id`, `kind`, `status`, `attachment_id`, `client_uuid`, `lat/lng`).
  Dépôt **idempotent** via `client_uuid` (mig 177). `addVisitCapture` fait déjà tout ça.
- **Vocal → transcription** : `processing_stage='pending'` déclenche le worker de fond.
- **Le tri** (écran 2 = `DebriefExpress` + `CaptureTriage`) et **le CR** (écran 3)
  ne connaissent que `report_id`. Ils se fichent de savoir d'où viennent les captures.

→ **Net-new réel = l'ingestion + la reconstruction chronologique + la session.**
Le reste (stockage, capture, transcription, tri, CR, mémoire) est réutilisé tel quel.

## 1. Le contrat d'entrée — `ingestBatch`

Le cœur. Une fonction, un contrat. Chaque source ne fait que **remplir ce contrat**.

```ts
// services/ingestion/ingest-batch.ts
ingestBatch(items: IngestItem[], ctx: IngestContext): Promise<IngestResult>

interface IngestItem {
  // le média : soit les octets, soit un chemin storage déjà uploadé
  blob?: Blob
  storagePath?: string
  filename: string
  mime: string
  kind: 'photo' | 'video' | 'vocal' | 'pdf' | 'note'
  /** LE moment réel (EXIF / horodatage _chat.txt / mtime). Null → fallback. */
  capturedAt: string | null
  text?: string | null        // note libre / ligne de chat
  lat?: number | null
  lng?: number | null
  /** Clé de dédup stable propre à la source (ex. "whatsapp:<msgId>", ou hash). */
  sourceRef?: string
}

interface IngestContext {
  siteId: string
  createdBy: string | null
  source: 'whatsapp_zip' | 'os_share' | 'upload' | 'email' | 'whatsapp_cloud'
  /** Session à alimenter si connue (WhatsApp Business). Sinon le moteur décide. */
  sessionHint?: { reportId: string } | null
}

interface IngestResult {
  sessions: Array<{ reportId: string; captureCount: number; startedAt: string }>
  created: number
  skippedDuplicates: number
}
```

Ce que le moteur fait, dans l'ordre :

1. **Normaliser** chaque item : résoudre `kind` + `capturedAt`
   (fallback : EXIF → mtime fichier → `now()`), déduire `mime`.
2. **Dédupliquer** : `client_uuid = sourceRef ?? hash(contenu)`. `addVisitCapture`
   est déjà idempotent sur `client_uuid` → un ré-import ne duplique rien.
3. **Trier par `capturedAt`** (chronologie réelle).
4. **Résoudre la/les session(s)** → un ou plusieurs `report_id` (cf. §3).
5. **Uploader** les octets (bucket `site-reports` + `site_report_attachments`) et
   **insérer les captures** via `addVisitCapture` (vocal → `pending` → transcription).
6. Retourner le récap (nb captures, sessions, doublons).

### ⚠️ La seule vraie lacune de schéma : `captured_at`
Aujourd'hui la timeline s'ordonne sur `created_at` (moment d'INSERTION). En direct
c'est bon (on insère en shootant). À l'import, l'insertion ne dit rien du moment
réel. Il faut **ajouter `visit_capture.captured_at timestamptz NULL`** et ordonner
partout la timeline sur `coalesce(captured_at, created_at)`. Petit patch, gros effet :
c'est lui qui permet « ordre chronologique reconstruit ».

## 2. Les adaptateurs — le seul code par source

Un adaptateur a **une seule** responsabilité : produire `IngestItem[]` + le `siteId`.
Il ne touche jamais au tri, au CR, à la transcription.

- **`upload`** (desktop drag-drop / mobile file picker) — lit EXIF/mtime. *Le plus simple, à faire en même temps que le ZIP pour prouver l'universalité.*
- **`whatsapp_zip`** (niveau 1, cible) — dézippe, parse `_chat.txt` (horodatage +
  émetteur + réfs médias inline), mappe chaque fichier média → `IngestItem` avec
  `capturedAt` = horodatage de la ligne (fallback EXIF). `sourceRef = "whatsapp:<ligne>"`.
- **`os_share`** (niveau 3) — `share_target` PWA Android / feuille de partage iOS.
- **`whatsapp_cloud`** (niveau 4) — webhook → télécharge le média → `ingestBatch`
  avec `sessionHint` (la session ouverte de cet émetteur). Même moteur, zéro nouveau pipeline.
- **`email`**, **dossier Windows** — hors périmètre actuel, mais gratuits une fois le moteur là.

## 3. La session de visite — la brique transverse

> « Un sous-traitant envoie des médias pendant deux jours. Une visite ou deux ? »

Une **session** = la visite ouverte d'un `(organization, site, owner)`, matérialisée
par `site_report.ended_at IS NULL`. **Ce concept existe déjà** (getActiveVisit /
reopenVisit) — on le promeut en **politique explicite** partagée par toutes les portes :

```ts
// services/ingestion/visit-session.ts
resolveVisitSession(ctx, capturedAt): Promise<{ reportId, opened: boolean }>
```

### Règle d'ouverture / rattachement / fermeture

- **Ouverture** : premier média sans session ouverte, OU commande « Début visite ».
- **Rattachement (grouping déterministe)** : en parcourant les items triés par
  `capturedAt`, on rattache à la session courante tant que l'écart avec la capture
  précédente **≤ GAP_MAX**. Si l'écart **> GAP_MAX** (ou changement de jour
  calendaire) → on **clôt** la session précédente et on **en ouvre une nouvelle**.
  → Un dump de 2 jours devient automatiquement **2 visites**. Sans IA.
- **Fermeture** — trois déclencheurs, par ordre d'autorité :
  1. **Manuelle** « Fin de visite » — fait toujours foi (WhatsApp Business : commande texte).
  2. **Inactivité (cron)** : une session dont la dernière capture dépasse
     `SESSION_IDLE` reçoit `ended_at`. Garde la notion de « visite en cours » saine,
     y compris pour la porte directe (visite oubliée ouverte).
  3. **Grouping** (ci-dessus) : à l'ingestion, un grand écart clôt implicitement.

### Recommandation de valeurs (à confirmer — décision produit)
- **GAP_MAX ≈ 3–4 h** *ou franchissement de minuit*. 2 h est risqué : une vraie
  visite peut avoir une coupure déjeuner. On veut séparer les JOURS, pas les pauses.
- **SESSION_IDLE ≈ 4–6 h** pour l'auto-clôture cron.
- Tunable par organisation plus tard.

### Principe reconduit : MemorIA **propose**, l'humain **décide**
Le grouping est une **reconstitution proposée**, jamais un fait imposé. Avant le tri,
l'écran de reconstruction montre : « MemorIA a reconstitué **2 visites** (mardi 14 /
mercredi 9) — c'est bien ça ? [Oui, trier] [Tout regrouper en une seule] ». Le
regroupement est **réversible** (aucun objet métier n'est créé à ce stade — les
réserves/actions restent validées à la main plus loin). Split/merge fin = v2.

## 4. Le parcours — les deux portes convergent

Point d'architecture : **l'import ne fabrique pas un écran ; il fabrique un
`report_id`** et redirige vers le tri EXISTANT.

```
Sous-traitant (inchangé)         Conducteur
  envoie photos + vocaux           Accueil mobile : nouvelle entrée
        (WhatsApp)                   « 📥 Importer une visite WhatsApp »
                                              │  choisit le .zip
                                              ▼
                                   adaptateur whatsapp_zip → ingestBatch
                                              ▼
                                   Écran de reconstruction (confirmation) :
                                     « 28 captures · 15 vocaux transcrits ·
                                       ordre chronologique · 2 visites »
                                              │  [Oui, trier]
                                              ▼
                              /m/visite/[reportId]  ← MÊME écran que la visite en direct
                                 (DebriefExpress + CaptureTriage + CR)
```

La visite en direct arrive déjà sur `/m/visite/[reportId]`. L'import y arrive aussi.
**C'est là que MemorIA devient cohérent** : une seule mémoire, un seul tri, un seul CR,
quelle que soit la porte.

## 5. Découpage de livraison (niveau 1, pensé pour le niveau 4)

1. **Schéma** : `visit_capture.captured_at` + `site_reports.source` (trace la porte).
   Ordonner la timeline sur `coalesce(captured_at, created_at)`.
2. **Moteur** : `ingestBatch` + `resolveVisitSession` (grouping déterministe).
   *C'est l'investissement durable ; tout le reste s'y branche.*
3. **Adaptateurs jumeaux** : `upload` (multi-fichiers) **et** `whatsapp_zip`, pour
   prouver dès le départ que le moteur est universel et pas « spécial WhatsApp ».
4. **Écran de reconstruction** (confirmation) → redirection vers le tri existant.
5. **Cron d'auto-clôture** (`SESSION_IDLE`) — réutilise l'infra cron des captures « coincées ».

Niveaux 3 (partage OS) puis 4 (WhatsApp Business) = **de nouveaux adaptateurs**
sur le même moteur + la même session. Rien à refaire au cœur.

## Décisions à trancher avant de coder
- **GAP_MAX** et **SESSION_IDLE** (valeurs ci-dessus — à valider).
- Le grouping découpe-t-il par défaut, ou propose-t-il toujours « 1 visite » et
  l'humain découpe ? (Reco : découper par jour, puis confirmer.)
- `captured_at` manquant (WhatsApp perd parfois l'EXIF) : fallback horodatage
  `_chat.txt` → mtime → `now()`. OK ?
