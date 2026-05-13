# Journal des décisions

Décisions architecturales et produit notables, avec leur contexte et leur raison. À compléter à chaque décision significative.

---

## 2026-05-13 — Monitoring admin : exception doctrinale assumée pour métriques per-user

**Décision** : `/admin/monitoring` conserve un tableau utilisateurs avec dernière connexion + nombre d'actions sur la période, ainsi qu'un feed nominatif de l'activité récente. Décision prise par le DG après audit doctrinal qui a identifié la violation de Doctrine V5.

**Raison** : le DG a un besoin réel d'hygiène opérationnelle (« qui s'est logué, pour faire quoi »). Le strict respect de la doctrine V5 sur cette surface empêcherait l'admin de diagnostiquer un compte abandonné, un chef d'équipe qui n'utilise pas l'outil, ou un manager qui ne fait pas son travail. Cette surface est admin-only et ne sort jamais vers les utilisateurs concernés.

**Garde-fous explicites** :
- Surface admin uniquement (RLS + check de rôle en tête de page)
- Aucune de ces données ne sort jamais en PDF, en export, vers un manager ou vers un client
- Pas de classement, pas de score, pas de comparaison inter-utilisateurs visible
- Le contexte du tableau reste « hygiène d'identité », pas « évaluation des performances »

**Alternative écartée** : version anonymisée par rôle (« 3 chefs d'équipe actifs, 47 actions »). Trop floue pour diagnostiquer des problèmes opérationnels concrets.

**Impact code** : commentaire d'avertissement en tête de `lib/db/admin-monitoring.ts` pour qu'aucun futur dev ne réutilise ces helpers ailleurs.

---

## 2026-05-13 — Mot de passe temporaire aléatoire à usage unique (sécurité)

**Décision** : le fallback hardcodé `'netoiage2026'` dans `createUserAction` et `forcePasswordResetAction` est supprimé. Chaque création de compte en mode temp_password et chaque reset génère un mot de passe aléatoire (16 chars base64url, ~96 bits d'entropie) affiché une seule fois à l'admin dans un dialog.

**Raison** : audit sécurité a identifié le fallback hardcodé comme vulnérabilité critique. Tout compte créé partageait le même mot de passe initial — bombe à retardement si la variable d'env n'était pas configurée en prod.

**Impact code** : `app/admin/users/actions.ts`, `app/admin/users/CreateUserForm.tsx`, `app/admin/users/ForcePasswordResetButton.tsx`, `app/admin/users/page.tsx`.

---

## 2026-05-13 — Défense en profondeur sur la lecture du rôle utilisateur

**Décision** : `getUserRoleById(userId)` tente d'abord le server client (RLS appliqué) pour les self-reads. Fallback admin client uniquement pour les lookups cross-user (admin lisant un autre user) ou les contextes sans session (scripts).

Ajout d'un `getCurrentUserRole()` pour le code neuf — API préférée, jamais d'admin par défaut.

**Raison** : audit a montré que toutes les `requireAdmin/requireManagerOrAdmin/requireFieldAgent` des 20 fichiers de server actions appellent `getUserRoleById` en bypass admin. La nouvelle stratégie ferme ce vecteur quand l'utilisateur lit son propre rôle (cas dominant), sans casser les call sites existants.

**Migration future restante** : la couche `lib/db/` utilise massivement l'admin client (~150 call sites). Migration progressive recommandée — priorité aux fonctions user-scope (`listInterventionsVisibleToUser`, `getSiteResumeContext`, etc.) qui devraient passer en server client + RLS. Les agrégats admin (dashboard, monitoring, audit log) gardent l'admin client à juste titre.

**Impact code** : `lib/db/users.ts` (transparent — aucun call site à modifier). `lib/auth/require.ts` ajouté comme point central pour le code neuf.

---

## 2026-05-13 — Middleware enforce must_change_password sur toutes les routes

**Décision** : création d'un `middleware.ts` racine qui vérifie le flag `app_metadata.must_change_password` du JWT et redirige vers `/change-password` toute requête authentifiée tant que le flag est actif.

**Raison** : audit sécurité a montré que `must_change_password` n'était vérifié qu'au login. Un utilisateur pouvait obtenir un JWT via cURL, sauter la redirection, et appeler n'importe quelle server action avec le mot de passe temporaire. Le middleware ferme cette porte.

**Impact code** :
- `middleware.ts` (nouveau, racine)
- `app/admin/users/actions.ts` : `createUserAction` (temp mode) et `forcePasswordResetAction` posent `app_metadata.must_change_password = true` via l'admin API
- `app/(auth)/change-password/actions.ts` : efface `app_metadata.must_change_password` via l'admin API après changement réussi

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
