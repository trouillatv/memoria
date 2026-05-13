# Journal des décisions

Décisions architecturales et produit notables, avec leur contexte et leur raison. À compléter à chaque décision significative.

---

## 2026-05-13 — Monitoring admin : requêtes live, pas d'agrégats précalculés

**Décision** : le monitoring admin (`/admin/monitoring`) utilise des requêtes SQL directes à chaque chargement de page. Pas de table de métriques, pas de cron.

**Raison** : le volume d'une PME nettoyage (< 100 users, < 1000 interventions/mois) ne justifie pas une infra de métriques. Les requêtes live restent < 200ms sur ce volume.

**Alternative écartée** : table `admin_metrics_daily` calculée chaque nuit — infra supplémentaire, données décalées de 24h, complexité de maintenance.

---

## 2026-05-13 — Suppression page `/admin/preparation`

**Décision** : page supprimée car redondante avec la gestion des téléphones dans `/admin/users`.

**Raison** : la préparation des chefs d'équipe (WhatsApp 1-à-1) est accessible depuis la page users. Maintenir deux surfaces pour la même fonctionnalité créait de la confusion.

---

## 2026-05-13 — Archive avec motif pour les engagements actifs

**Décision** : les engagements `active` ne peuvent pas être supprimés (hard delete ou reject). Ils doivent être archivés avec un motif obligatoire (min 3 chars).

**Raison** : un engagement actif peut avoir des interventions liées. Supprimer brutalement casserait la chaîne Engagement→Mission→Intervention→Preuve. L'archivage préserve la traçabilité. Si des interventions sont déjà liées (`hasLinkedInterventions()`), l'archivage est bloqué.

**Implémentation** : `archiveEngagement(id, reason)` stocke `source_ref: { archived_reason, archived_at }`.

---

## 2026-05-12 — Doctrine V5 : pivot "organisation vs surveillance"

**Décision** : reformulation du principe directeur. Le produit organise la couverture terrain, il ne mesure jamais les humains. Toute feature qui attribue une performance à un individu est interdite.

**Test ultime** : "Est-ce que ce champ rend un humain anonyme ?" Si non → interdit.

**Impact code** : pas de `assigned_to` sur les interventions, pas de métriques par personne, affectation par équipe uniquement.

---

## 2026-05-13 — WhatsApp desktop via schéma URI `whatsapp://`

**Décision** : sur desktop (non-mobile), le bouton de partage tente `whatsapp://send?text=...` plutôt que `https://api.whatsapp.com/send`.

**Raison** : `whatsapp://` ouvre l'app desktop native si installée, sans passer par le navigateur. Le texte est aussi copié dans le clipboard comme fallback.

**Alternative écartée** : `https://api.whatsapp.com/send` — URL externe, risque de tracking, ne fonctionne pas si pas de navigateur par défaut configuré.

---

## 2026-05-XX — Récurrence paresseuse à 7j

**Décision** : les interventions récurrentes sont générées à la demande pour les 7 prochains jours uniquement, pas en masse.

**Raison** : éviter des milliers de lignes en DB pour des contrats longs. La vue semaine et le briefing déclenchent la génération pour leur fenêtre temporelle.

**Risque géré** : si personne ne consulte l'appli pendant > 7j, des interventions passées ne sont pas créées. Acceptable — si personne ne regarde l'appli, les interventions n'ont pas lieu non plus.

---

## 2026-05-XX — `engagement_ids[]` sur missions (pas de table de jonction)

**Décision** : la relation many-to-many Missions↔Engagements est stockée comme tableau `uuid[]` côté `missions.engagement_ids`, pas via une table de jonction `mission_engagements`.

**Raison** : simplification des requêtes de compliance. La majorité des lectures vont "d'un engagement → quelles missions le couvrent" ou "d'une mission → quels engagements". Avec un tableau, `contains('engagement_ids', [engagementId])` suffit.

**Limite** : pas de métadonnées sur la relation. Acceptable pour le cas d'usage actuel.

---

## 2026-05-XX — Multi-provider IA avec factory

**Décision** : l'IA est abstraite derrière une factory (`services/ai/factory.ts`). Le code produit ne référence jamais directement Anthropic ou Gemini.

**Raison** : les providers évoluent vite. Découpler permet de changer de provider sans toucher au code métier. Le provider `mock` permet des tests déterministes sans appel API.

**Sélection** : variable d'environnement `AI_PROVIDER` (mock | anthropic | gemini).

---

## 2026-05-XX — Soft delete systématique

**Décision** : toutes les entités métier utilisent `deleted_at` (soft delete). Aucun `DELETE` physique.

**Raison** : traçabilité et récupération en cas d'erreur. Les preuves, interventions et engagements doivent rester accessibles même après "suppression" (litige potentiel).

**Exception** : données de test (`__test`) — supprimées physiquement par le teardown Vitest.

---

## 2026-05-XX — Verrou V3 : "clôturé" pas "résolu"

**Décision** : le vocabulaire du dossier de preuve utilise "clôturé" (action irréversible), jamais "résolu" (jugement de valeur sur la situation).

**Raison** : "résolu" implique que le problème n'existe plus, ce qui peut être juridiquement faux. "Clôturé" est un acte documentaire neutre, défendable en cas de litige.

---

## Template pour nouvelles entrées

```
## YYYY-MM-DD — Titre court

**Décision** : ce qui a été décidé

**Raison** : pourquoi (contrainte, incident passé, préférence forte)

**Alternative écartée** : ce qu'on n'a pas fait et pourquoi (optionnel)

**Impact code** : fichiers ou patterns affectés (optionnel)
```
