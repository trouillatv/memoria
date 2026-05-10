# Phase 4 — Cross-tender matching (moat)

_Closed 2026-05-11. Slices 4.0 → 4.4._

## Quoi

Quand un Resp. AO consulte la mémoire technique d'un AO en cours
(`/tenders/<id>?view=memoire`), un panneau à droite affiche les engagements
similaires détectés dans ses contrats passés, avec leurs preuves chiffrées
(interventions exécutées, photos, anomalies) et un bouton 1-clic pour insérer
une phrase de preuve directement dans la mémoire.

## Pourquoi

C'est le **moat** : plus le tenant accumule de contrats exécutés, plus le
panneau devient riche. Un concurrent ne peut pas répliquer ça en J0 — il faut
des années d'exécution de terrain pour générer cette base de preuves.

## Stack

| Couche | Composant |
|---|---|
| DB | Migration `020_engagement_similarity.sql` — `pg_trgm` + RPC `find_similar_engagements` |
| Helpers | `lib/db/engagements.ts` → `findSimilarEngagements`, `findSimilarEngagementsForMemo` (chunking), `getEvidenceForEngagement(s)` |
| UI | `app/(dashboard)/tenders/[id]/EvidencePanel.tsx` (server component) + `InsertEvidenceButton.tsx` (client + useTransition) |
| Server action | `app/(dashboard)/tenders/[id]/actions.ts` → `insertEvidenceIntoMemoire` |

## Paramètres par défaut

- **Threshold trigram** : `0.25`
- **Limite matches affichés** : `8`
- **Filtre rich** : matches avec `interventionsExecuted > 0` uniquement (les autres sont masqués pour éviter "0 photos / 0 interventions")
- **Chunking memo** : split par titres markdown + paragraphes + fallback phrase, cap 30 chunks. Justification : `pg_trgm.similarity()` est sensible à la longueur ; un mémoire de 3000 chars renvoie 0 match au threshold 0.25, alors qu'un paragraphe de 80-150 chars dépasse facilement 0.5.
- **Aggregation cross-chunks** : `max(similarity)` par engagement_id

## Idempotence insert

Marker HTML `<!-- ref: engagement:UUID -->` ajouté à la fin du snippet. Le
panneau scanne le mémoire au render pour pré-cocher les engagements déjà
insérés. Le rendu markdown strippe le marker (HTML comment ignoré par
react-markdown / marked).

## Doctrine respectée

- Stats **aggregate uniquement** par engagement (cf. `planning-doctrine.md §5`)
- **Jamais** de mention nominative dans le snippet (le contrat est la preuve, pas l'agent)
- Engagements `extracted` / `curated` / `archived` NEVER returned — seuls `active` ou `completed` comptent comme preuves

## Démo

Seed `scripts/seed-demo.ts` crée 4 tenders :
1. CHU Régional (contrat actif, mature, 12 interventions validées)
2. Banque Centrale (contrat actif, 5 interv.)
3. École Jean Jaurès (contrat actif récent, 1 in_progress)
4. **Hôpital Sainte-Marie** (status `ready`, pas de contrat) — c'est l'AO en cours qu'on ouvre pour voir le panel

Smoke test : `npx tsx scripts/phase4-smoke.ts` — vérifie ≥3 rich matches.
Sortie attendue : 5 rich matches (CHU + Banque) avec similarités 47-93%.

## Dette tracée

- Tests server action `tests/lib/insert-evidence.test.ts` restent `describe.skip` — déskipper après introduction d'un helper `withMockedSupabase` (refactor test infra).
