# 05 — Cohérence mobile / desktop (visites)

> Audit 2026-07-13, post-session Guillaume. Faits vérifiés dans le code (fichier:ligne).
> Doctrine : le mobile capture, le desktop prépare/relit/exploite. On ne cherche pas la
> parité artificielle — on corrige les **pertes d'information** (donnée capturée sur
> mobile sans aucune surface desktop).

## Cause racine (à lire en premier)

La page débrief desktop reconstruit le contenu d'une visite **par fenêtre temporelle
sur d'autres tables** (`site_notes`, `site_actions`, `site_reserve`,
`site_report_attachments` — noms de fichiers seulement) au lieu de lire les captures
de la visite par `report_id` :

- `gatherVisitDebriefContext` — `lib/db/visits.ts:1723-1760` : ne lit **jamais** `visit_capture`.
- Le mobile, lui, lit `listVisitCaptures(reportId)` (lib/db/visit-captures.ts).

**Rebrancher le débrief desktop sur `listVisitCaptures(reportId)` corrige les pertes
n°1, 2 et 4 d'un coup.** Les helpers existent déjà (`listVisitCaptures`,
`getVisitCapturePreviewUrls`).

> **Règle (validée Vincent 2026-07-13) : une visite a UNE seule source de vérité —
> `visit_capture` par `report_id`. Le desktop PRÉSENTE cette donnée autrement, il ne
> la recalcule jamais.** Il n'y a pas deux produits (Source A → mobile, Source B →
> desktop) ; toute reconstruction par fenêtre temporelle est interdite.

## Modèle de données des captures terrain

- `visit_capture` (mig 165) — l'atome du panier terrain. Kinds : `photo | video |
  vocal | note | verification | position`. Médias stockés via
  `site_report_attachments` (`attachment_id`). Transcript vocal dans
  `visit_capture.body` (`lib/db/visit-captures.ts:483`).
- `visit_watchlist` (mig 196) — les points « à vérifier ». Lecteur unique :
  `listWatchlist(reportId)` (`lib/db/visit-watchlist.ts:16`).
- `captured_knowledge` (mig 170) — « à retenir » / questions
  (`lib/db/captured-knowledge.ts:78`).

## Matrice

| # | Fonction | Mobile | Desktop | Écart |
|---|----------|--------|---------|-------|
| 1 | Liste visites passées | `/m/site/[siteId]/visites` | `/sites/[id]` onglet Activité → `SiteVisitsList.tsx` + `/sites/[id]/visites` | OK (chaque ligne mène au débrief, pas au récap) |
| 2 | **Photos de visite** (`visit_capture` kind=photo) | Récap `/m/visite/[reportId]/recap/page.tsx:197-202` (miniatures) | **Aucune image** — débrief affiche `attachmentNames.join(' · ')` (noms de fichiers, `visites/[visitId]/page.tsx:70`) ; `/sites/[id]/photos` lit `intervention_photos` uniquement (`site-cockpit.ts:2506`) | **PERTE** |
| 3 | **Vocaux** (audio + transcript par capture) | Récap `recap/page.tsx:206` (lecteur `<audio>`) | Compteur = `visit.transcript ? 1 : 0` sur le transcript report-level ; audio non écoutable | **PERTE** |
| 4 | **Notes / points vérifiés** (kind=note/verification) | Récap `recap/page.tsx:39-42,187` | Débrief lit `site_notes` par fenêtre temporelle (`visits.ts:1733`) ; kinds `verification` jamais surfacés | **PERTE partielle** |
| 5 | **Watchlist « à vérifier »** | `WatchlistDebrief.tsx`, `/m/visite/[reportId]/page.tsx:80` | **Aucun lecteur** de `visit_watchlist` sous `app/(dashboard)` — seuls les items promus (action/réserve) remontent | **PERTE** (états verified/to_follow/dismissed invisibles) |
| 6 | **CR de visite PDF** | Route `/m/visite/[reportId]/pdf` | `GenerateCrButton.tsx` = markdown client-side (.md), photos en URLs `<pre>` ; aucun lien vers la route PDF | **PERTE** |
| 7 | **Récap durable** (`/m/visite/[id]/recap`) | Vue complète + onglets mémoire | Pas d'équivalent ni de lien | **PERTE** |
| 8 | Carte des captures | positions dans captures | OK — `/sites/[id]/carte` → chronicle embarque `CaptureMap` (`chronicle/page.tsx:22,48`) | — |
| 9 | Actions créées en visite | débrief express | OK — `site_actions` sur `/sites/[id]` (OpenActionsList) | — |
| 10 | Réunions | `/m/reunion/[reportId]` renvoie vers `/meetings/[id]` (`reunion/page.tsx:107`) | `/meetings/[id]` plus riche | Inversé, assumé, pas de perte |

## Top 5 des pertes à corriger (ordre de valeur)

1. **Photos de visite en image** — vignettes dans le débrief `/sites/[id]/visites/[visitId]` (et/ou `/sites/[id]/photos` élargie aux pièces de report).
2. **Vocaux** — lecteur + transcript par capture dans le débrief.
3. **Watchlist** — bloc « Ce qu'il fallait vérifier » + bilan (via `listWatchlist`).
4. **Notes/vérifications capturées** — lire `visit_capture` au lieu de la fenêtre temporelle.
5. **CR PDF + récap** — deux liens sortants depuis le débrief (« Ouvrir le CR PDF », « Voir toutes les captures »).

Les corrections 1, 2, 4 sont **le même changement** (rebrancher le débrief sur
`listVisitCaptures`) ; 3 et 5 sont des ajouts de lecture sans migration.
