# Journal des décisions

Décisions architecturales et produit notables, avec leur contexte et leur raison. À compléter à chaque décision significative.

---

## 2026-05-19 — Règle de gouvernance : toute ouverture paie son coût structurel

**Décision** : élévation, en tête de `exploitation-doctrine-V6.md`, d'un principe de gouvernance opposable : toute ouverture/exception est recevable, mais une ouverture sans garde-fous exécutables est nulle ; les verrous (tests CI, interdits structurels) sont livrés dans le même changement que l'exception. Ajout d'une 6ᵉ question conditionnelle au Test consolidé V6.

**Raison** : V6.7 a prouvé que la doctrine peut s'ouvrir sans se dissoudre — mais uniquement parce que l'ouverture a payé son coût structurel. Sans règle gravée, la prochaine demande « le terrain le demande » rouvre le débat de zéro (dérive par concessions successives décrite dans `refusals-log.md`). Le principe est lui-même une ouverture de la couche gouvernance : il paie son coût en devenant opposable plutôt que conversationnel.

**Limite assumée** : le texte rend le principe citable, pas auto-appliquant. Son effet réel dépend d'exiger les tests dans la même PR que la feature, à l'usage.

**Lien** : Conversation Claude 2026-05-19 (suite directe de l'arbitrage V6.7 ci-dessous).

---

## 2026-05-19 — Doctrine V6.7 : réouverture bornée « reprise & continuité »

**Décision** : Vincent arbitre l'ouverture, dans `exploitation-doctrine-V6.md` (Pilier V6.7), de deux capacités jusqu'ici refusées : (1) surfaces de continuité site/contrat rendues **obligatoires** (intervenants en continuité, libellés non navigables) ; (2) **brief de reprise déclenché par événement** (départ/indisponibilité d'un intervenant) où la personne est un paramètre éphémère et le sujet du résultat est le site/contrat. Reste **refusé, inchangé** : toute route/page/recherche/index dont le sujet d'entrée est une personne (V6.2).

**Raison** : besoin terrain Guillaume réel et récurrent — anticiper la perte de continuité quand un porteur de mémoire part. Le strict V6.2 ne le servait que passivement (le site lit « continuité en baisse » *après* coup). Le brief déclenché-par-événement répond au besoin sans matérialiser un sujet-personne navigable.

**Garde-fous (six verrous simultanés, cf. Pilier V6.7)** : déclenchement-événement uniquement ; éphémère / zéro persistance ; sujet du résultat = site/contrat ; seuil k=4 anti-ré-identification (comble un trou laissé par V6) ; log d'audit obligatoire ; surfaces exploitation/admin only (jamais mobile/PDF/export/client). Retirer un verrou = retour au refus V6.2.

**Alternative écartée** : Option C (menu « Intervenants » + fiche personne limitée, même sans heures/score). Écartée : aucun bénéfice unique sur la version déclenchée-par-événement, et risque structurel SIRH — le critère « frontière techniquement infranchissable par accident » exigé par Guillaume lui-même l'interdit.

**Impact code** : Enforcement V6 étendu **livré** — `tests/doctrine/v67-brief-reprise.test.ts` grave les verrous 6-9 (déclenchement-événement, zéro persistance, seuil k, audit). Verrous 6/7/9 = tripwires structurels : verts sur le code actuel (feature *brief de reprise* toujours non construite), rouges dès qu'un générateur viole un verrou (vérifié par probes non-conformes). Verrou 8 = fonction pure testée `applyContinuityKThreshold` (`lib/db/site-cockpit.ts`, k=4 gravé) : le contrat importable que le futur brief DEVRA traverser. **Bornage assumé** : le helper k=4 n'est *pas* recâblé dans la surface site-first `HumanContinuityList` déjà livrée (V5.1.4, gouvernée V5.1.3) — étendre k=4 à cette surface est une décision produit/doctrine distincte, hors périmètre des verrous V6.7. Le brief lui-même reste non implémenté (cf. Séquence d'activation : interprétatif « jamais avant » le pilote).

**Lien** : Conversation Claude 2026-05-19 (session MemorIA, branche `feat/access-events`). Registre des refus mis à jour.

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

## 2026-05-14 — Discipline produit post-audits : verrou V6 + registre features

**Décision** : après les 5 audits de rôle (DG, Manager, Chef d'équipe, Cliente, Avocate) + 5 audits techniques sur les Phases 1-4 livrées, formalisation d'un **principe d'attention minimale** (verrou V6) et création d'un **registre des features refusées** pour éviter la dérive ERP.

**Raison** : les 9 audits ont identifié ~20 frictions réelles. Beaucoup de solutions paresseuses (push notifications, ticketing client, score de criticité, auto-distribution planning, portail extranet) ramèneraient MemorIA vers Progiclean/PROPRET. La discipline produit est désormais la principale source de différenciation.

**Impact code** :
- `docs/09_REGLES_DE_MODIFICATION.md` : nouveau verrou V6 « Principe d'attention minimale »
- `docs/11_REGISTRE_FEATURES.md` : nouveau document trackant sprints livrés, en cours, reportées (post-pilote), refusées (anti-doctrine)

**Features explicitement refusées et inscrites en registre** :
- Push notifications temps réel anomalies
- Tri par criticité avec champ severity
- Score d'urgence
- Auto-distribution planning
- Module ticketing client
- Portail extranet client
- Email auto multi-destinataires
- Suivi de qui a lu quoi (côté collaborateurs internes)

**Features reportées post-pilote réel** (à reconsidérer après retour terrain, pas avant) :
- Mode prise de poste
- Patterns récurrents
- Transmission silencieuse à l'archivage user
- Voix sur À savoir + anomalies

**Phrase produit consolidée** : *MemorIA = l'endroit où la mémoire opérationnelle survit aux humains, et tient juridiquement, sans demander leur attention.*

---

## 2026-05-14 — Mot de passe temporaire partagé `memoria2026` (revert)

**Décision DG (revert)** : mot de passe temporaire en dur, `memoria2026`, pour toutes les créations en mode temp_password et tous les resets. Pas de variable d'environnement, pas de dialog d'affichage à la création/au reset.

**Raison** : la version aléatoire à usage unique (livrée le 2026-05-13 suite à l'audit) ajoutait un dialog modal et un copier-coller manuel à chaque création/reset. UX trop friction pour le DG. La doctrine de l'app vise la simplicité opérationnelle.

**Garde-fous compensatoires conservés** :
- `must_change_password` flag posé en DB ET en `app_metadata.must_change_password` du JWT
- Middleware racine `middleware.ts` redirige toute requête authentifiée vers `/change-password` tant que le flag est actif — empêche un attaquant qui connaîtrait `memoria2026` d'utiliser un compte non encore initialisé sans changer le mdp
- L'attaque résiduelle reste : si un attaquant connaît l'email d'un user fraîchement créé/reseté et qu'il bat l'user à la première connexion, il peut prendre le contrôle du compte. Mitigation : prévenir l'user de la création par un canal différent (SMS/WhatsApp), et lui demander de se connecter rapidement.

**Impact code** : revert de `app/admin/users/actions.ts`, `CreateUserForm.tsx`, `ForcePasswordResetButton.tsx`, `page.tsx`.

---

## 2026-05-13 — Mot de passe temporaire aléatoire (annulé le 2026-05-14)

**Décision (annulée)** : génération aléatoire 96 bits par création/reset, affichée une fois dans un dialog admin.

**Annulé** : voir entrée 2026-05-14 ci-dessus. Le compromis UX/sécurité a été tranché en faveur de l'UX.

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
