# P3-D2 — Date propre de l'événement (event_date), distincte de la date du document

Date : 2026-08-28. Suite de P3-D1. Sépare **date documentaire** (PV) de **date propre du fait**.
Code + migration + tests + dry-run. **Aucun backfill.**

## 1. Contrat temporel

| Champ | Sens | Politique |
|---|---|---|
| `effective_date` | date du document / de la visite (PV) | **inchangée** ; pilote `lastSeenAt` |
| `event_date` *(nouveau, nullable)* | date propre du fait quand fiablement extraite | `null` si aucune date fiable — **jamais recopier la date du PV** |

Position temporelle longitudinale = **`COALESCE(event_date, effective_date)`**.

## 2. Ne pas surcharger effective_date

`effective_date` reste la date documentaire (consommée par `lastSeenAt`, tri, stagnation). On **ajoute**
`event_date` (mig 363, additif, nullable, hors clé d'unicité). Le mismatch P3-C reste résolu par D1
(state_key) ; D2 corrige la **temporalité interne**.

## 3. Extraction — RÉUTILISE la brique existante (aucun 2ᵉ LLM)

`detect-document-date.ts` (P0-B) classait déjà les dates par sémantique — dont `event_date`
(« réalisé/contrôlé le … ») et `deadline_date`. `lib/documents/event-date.ts` :
`extractEventDate(texts)` ne retient que les candidats `event_date`, dédupliqués par confiance.
Petite extension générique de la brique (rule 5b) : « contrôlé **par X** le <date> » (verbe non collé à
« le »), en **excluant** les prévisionnels (« prochain contrôle **prévu** le … » = échéance).
Garde métier : un état **`deadline`** ne porte jamais d'event_date (sa date est une échéance).

## 4. Cas (tous vérifiés au dry-run Bella)

| Cas | Résultat |
|---|---|
| Historique rappelé « contrôlé … le 22/03/2024 » | **event_date = 2024-03-22** (électrique, éclairage) ; cuisson « Fait le 25/03/2022 » → 2022-03-25 |
| État constaté « à refaire immédiatement » | **null** (pas de date propre → position = date du PV) |
| Échéance « à refaire avant novembre 2025 » / état deadline | **null** (c'est une échéance, pas un event_date) |
| Date partielle « en 04/23 » (mois/année, sans jour) | **null** (non structurée, reste textuelle) |
| Prévisionnel « prochain contrôle prévu le 14/07 » | **null** (forecast exclu) |
| Plusieurs dates événementielles proches | ambigu → **null** (jamais la première naïvement) |

## 5. Décision consumers (tracée)

- **`lastSeenAt` = `effective_date`** (dernière apparition DOCUMENTAIRE) — **inchangé**. Un PV 2025
  rappelant un contrôle 2024 → le sujet a bien été **vu en 2025** ⇒ lastSeen 2025. Correct.
- **`lastMeaningfulChangeAt` / ordre de la ligne de vie = `COALESCE(event_date, effective_date)`** — un
  fait daté 2024 rappelé dans un PV 2025 ne doit **pas** remonter comme un changement récent. C'est
  précisément la distinction `lastSeenAt` ≠ `lastMeaningfulChangeAt`.
- Cette consommation est un **NO-OP tant que `event_date` est NULL** (tout l'existant). Elle sera **câblée
  dans le lot backfill A** (quand les occurrences porteront un event_date), en threadant `event_date`
  dans le read-model `canonical-subject-life` (`lmcaOccsA` + `collapseLmcaOccurrencesByDate`, déjà en
  place). Non fait maintenant pour ne pas modifier le moteur de ligne de vie sans données à consommer.

## 6. Idempotence D1 + D2

`state_key` reste l'identité de l'état. `event_date` **n'entre PAS** dans la clé d'unicité : deux états
peuvent partager une date ; une **correction de date** ne crée pas de doublon (même `state_key`).

## 7. Dry-run Bella (SIMULATION, aucune écriture) — `scripts/dryrun-p3d2-event-date.ts`

Table `Sujet | État | document_date | event_date | preuve` produite sur les 32 états atomiques. Extraits :

| Sujet | État | document_date | event_date |
|---|---|---|---|
| **Contrôle éclairage de sécurité** | knowledge_fact | 2025-08-05 | **2024-03-22** |
| Contrôle des installations électriques | knowledge_fact | 2024-07-19 | 2024-03-22 |
| Contrôle des appareils de cuisson | knowledge_fact | 2024-07-19 | 2022-03-25 |
| Contrôle des extincteurs (2025) | knowledge_fact | 2025-08-05 | 2025-07-17 |
| Contrôle des extincteurs (2024) | knowledge_fact | 2024-07-19 | — null (« en 04/23 » partiel) |
| Nettoyage conduits | deadline | 2025-08-05 | — null (échéance) |
| … « à refaire » / OK / constats | — | — | — null (position = PV) |

**0 date ambiguë.** Dates internes toutes retrouvées ou correctement laissées null.

## 8. Critère de réussite — ATTEINT

Le modèle exprime sans ambiguïté :
- **22/03/2024 — contrôle éclairage réalisé** (`event_date=2024-03-22`, `effective_date=2025-08-05`) ;
- **05/08/2025 — contrôle à refaire** (`event_date=null` → positionné à la date du PV),
tout en sachant que les deux proviennent du **PV du 05/08/2025** (`source_ref_id` + `effective_date`).

## 9. Limites connues

- **Discriminateur d'état = famille** (hérité D1) : reste grossier — à re-tester sur CR 2026.
- **Multi-dates dans un état** (climatisation : plusieurs contrôles réalisés) : une date retenue par
  confiance ; imparfait mais toutes passées. À affiner si besoin.
- **Consommation LMCA/ordre** : NO-OP jusqu'au backfill (câblage dans A).

## 10. État de livraison

**CODÉ / COMPILÉ / TESTÉ / MIGRÉ (363 appliquée) — dry-run simulé, AUCUN backfill.** Workflow futur : les
occurrences porteront `event_date`. Existant inchangé.

**HARD STOP.** Pas d'audit UI, pas de backfill. Reste : **backfill A** (Bella + corpus, avec dry-run de
comptage + câblage de la consommation event_date), puis **audit écran par écran**, puis **CR 2026** =
recette end-to-end.
