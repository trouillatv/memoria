# Audit Slice 1 et décisions d'exécution — 2026-05-14

> Note de décisions tranchées par Vincent (délégation Claude) avant l'écriture du code de la Slice 1 du sprint V5.1. Ne PAS lire comme une doctrine — c'est un journal d'exécution. La doctrine vit dans `docs/superpowers/doctrines/`.

## 1. Audit : 80 % de l'infrastructure existe déjà

Avant de coder, j'ai audité le repo pour le périmètre Slice 1 (dépôt photo offline-first). Constat :

| Composant attendu pour Slice 1 | État réel |
|---|---|
| IndexedDB queue + backoff | ✅ `lib/field/photo-queue.ts` (queuePhoto, listQueuedPhotos, isReadyForRetry, removeQueuedPhoto, markAllReadyForRetry) |
| Bus sync events (toasts) | ✅ `lib/field/sync-events.ts` |
| Hook drain + retry online | ✅ `app/(field)/m/intervention/[id]/use-photo-uploader.ts` (backoff exponential, sync_success/sync_failure, online listener) |
| Server action upload | ✅ `app/(field)/m/intervention/[id]/actions.ts → uploadPhotoMobileAction` (SHA-256, Zod, hash_origin='verified') |
| Bouton photo 80px fullwidth | ✅ `photo-capture-button.tsx` variant=fullwidth — doctrine V5 J2 gravée |
| Mémoire site doctrinale | ✅ `lib/db/interventions.ts → getSiteResumeContext` (daysSinceLastVisit, recentAnomalies, recentSiteNotes — doctrine V5 explicite : on lit le site, pas la personne) |
| Pattern routes mobile | ✅ Group route `app/(field)/m/...` |

**Conséquence stratégique** : V5.1 Slice 1 n'est pas une création from-scratch, c'est une **extension chirurgicale** de l'existant pour le concept de **trace spontanée hors intervention pré-planifiée**.

## 2. Décisions tranchées (Vincent → délégation Claude)

### Q1 — Approche d'extension : **Alpha (extension)**

On étend `lib/field/photo-queue.ts` et le hook `usePhotoUploader` pour gérer la branche conditionnelle `if (!interventionId) → trace spontanée`. On ne crée pas de structure parallèle `trace-queue.ts`.

**Justification** :
- Réutilisation IndexedDB, backoff, sync-events, online-handler — pas de duplication.
- Tests sur la branche existante (flow intervention) garantissent zéro régression si l'extension reste additive.
- La structure `QueuedPhoto` accepte des champs additionnels nullable (`siteId?`, `intent?`, `clientUuid`) sans rupture.

### Q2 — Entrée hub `/m` : **Option B (FAB flottant)**

Bouton flottant `+ Photo libre` en bas de `app/(field)/m/page.tsx`, ouvre un sélecteur de sites de l'agent (déduits via le cluster `agentInterventions` qui existe déjà dans la page hub). Si l'agent n'a qu'un site connu → bypass le sélecteur, redirige direct vers `/m/site/[siteId]`.

**Justification** :
- Toujours visible, terrain-friendly (Joseph fatigué, gants).
- 2 taps max avant photo (FAB → site déduit OU FAB → tap site).
- Aligne avec la grammaire de rareté + dignité agent.

### Q3 — Refacto hook : **remonter vers `lib/field/use-photo-uploader.ts`**

Le hook devient utilisé par deux contextes (intervention planifiée + trace spontanée), donc il remonte d'`app/(field)/m/intervention/[id]/` vers `lib/field/`. Import path à updater dans `intervention/[id]/page.tsx`. Refacto chirurgical.

## 3. Périmètre Slice 1 révisé

5 additions chirurgicales :

1. **Helpers DB** : `lib/db/system-missions.ts` (`SYSTEM_MISSION_NAMES`, `isSystemMission`, `ensureSystemMission`, `getPlanningMissions`) + `lib/db/spontaneous-intervention.ts` (`findOrCreateSpontaneousIntervention` avec fenêtre 4h)
2. **Extension queue** : `QueuedPhoto` reçoit `siteId?`, `intent?: 'passage' | 'anomaly'`, `clientUuid` (toujours présent en V5.1). `kind` enum étend `'passage'`. `interventionId` devient optionnel.
3. **Server action** : `lib/field/actions/upload-spontaneous-trace.ts` — auth field-agent, find-or-create intervention spontanée, upload SHA-256, `insertPhoto` avec `ON CONFLICT (client_uuid) DO NOTHING`, anomalie chaînée si intent='anomaly' ET photo nouvellement insérée (idempotence anomalie par chaînage logique, pas de migration 052 nécessaire)
4. **Hook étendu** : `lib/field/use-photo-uploader.ts` branche sur `interventionId` null → spontaneous action sinon legacy action
5. **UI** : `app/(field)/m/site/[siteId]/page.tsx` (page dépôt libre) + FAB sur `app/(field)/m/page.tsx`

**Effort total révisé** : ~8h (au lieu de 14h from-scratch dans le plan V5.1.1).

## 4. Garde-fous à maintenir

- **Mission système non-planifiée** : helper centralisé `getPlanningMissions` obligatoire. Pas de filter dispersé.
- **Pas de catégorisation anomalie à Joseph** : `category='autre'`, description=null. Maeva enrichit plus tard si besoin.
- **client_uuid obligatoire** sur toute nouvelle entry queue (généré côté client à la prise photo).
- **`kind='passage'`** pour traces banales, jamais `'proof'` (préservation sémantique juridique).
- **Idempotence anomalie** : si la photo existait déjà (no-op ON CONFLICT), on skip aussi l'insertion anomalie.
- **Zéro régression** sur le flow intervention pré-planifiée existant.

## 5. Migrations DB déjà gravées (pré-Slice 1)

- `049_add_passage_photo_kind.sql` ✅
- `050_add_presentation_kind_to_proof_share_tokens.sql` ✅
- `051_add_client_uuid_to_intervention_photos.sql` ✅

## 6. Suite

Une fois Slice 1 livré et testé : Slices 2 (Joseph arrive), 3 (Page Site substrat), 6 (silence dimanche, parallélisable). Puis Slices 4 (capsule WhatsApp) et 5 (Résonances) qui dépendent des couches précédentes.
