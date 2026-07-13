# 03 — Stratégie de suppression / archivage par objet

> Audit 2026-07-13. L'existant est prouvé (fichier:ligne) ; les stratégies sont des
> PROPOSITIONS à valider — justifiées métier, jamais « on fera un soft delete ».
> Complément FK exhaustif : voir 02-dependencies.md.

## Doctrine de fond (validée Vincent 2026-07-13)

**Le vrai problème n'est pas l'absence de suppression — c'est l'incohérence** :
aujourd'hui visite=soft, réunion=hard, intervention=skipped, mission=rien,
client=rien. Chaque objet parle un langage différent.

Doctrine unique, raisonnée PAR MÉTIER, pas par table :

```
Jamais de suppression visible.
        ↓
     Retirer   (le seul verbe que voit l'utilisateur : « Retirer du chantier »)
        ↓
    Archiver   (l'objet sort des écrans courants, la mémoire reste)
        ↓
   Restaurer   (techniquement possible, exposé plus tard)
```

L'utilisateur ne se demande jamais « soft, hard ou skipped ? » — il voit UN verbe.
L'implémentation interne peut varier (tableau ci-dessous), le langage jamais.
La mémoire est l'actif du produit : **une preuve n'est jamais détruite par un geste
de rangement**. Le hard delete est réservé aux brouillons sans descendance.
Toute opération : confirmation + conséquences dites + rafraîchissement immédiat +
garde org/rôle.

## État livré aujourd'hui (prouvé)

| Objet | Mécanisme existant | Où |
|---|---|---|
| Visite | ✅ SOFT (`deleted_at`, mig 190) | `deleteVisit` (visits.ts:175) + action (debrief-actions.ts:295) — boutons MOBILE uniquement |
| Réunion | ✅ HARD + purge brouillons >24h | `deleteMeetingAction` (meetings/actions.ts:34,67) — détache les `site_actions` avant DELETE |
| Site | ✅ SOFT avec garde de dépendances | `softDeleteSite` (sites.ts:440) + `deleteSiteAction` (actions.ts:239) — BLOQUE si missions/interventions/notes |
| Équipe | ✅ SOFT | teams.ts:176 (`deleted_at` + `active:false`) |
| Rythme (template) | ✅ SOFT | `archiveTemplate` (intervention-templates.ts:195) |
| Intervention | ⚠️ SKIP seulement (`status='skipped'`, reste visible grisée) | intervention-templates.ts:624 |
| Mission | ❌ RIEN (colonne `deleted_at` existe, jamais écrite ; `active:false` possible sans bouton) | — |
| Client | ❌ RIEN (colonne `deleted_at` existe ; aucune fonction, aucun bouton) | — |

## Stratégies proposées

| Objet | Hard delete | Soft delete | Archive | Pourquoi (justification métier) |
|---|---|---|---|---|
| **Visite** | jamais | ✅ existant (étendre au desktop) | — | Une visite porte des preuves datées (photos, vocaux). L'erreur de manip se retire des écrans ; la preuve reste opposable. Captures conservées en base (soft ≠ cascade). |
| **Réunion** | ✅ brouillons/échecs SANS contenu validé (existant) | ✅ à AJOUTER pour une réunion avec décisions/PV | — | Un brouillon d'essai n'a pas de valeur mémoire → hard OK (déjà le cas). Une réunion validée a produit des décisions : on l'écarte, on ne l'efface pas. |
| **Intervention** | ✅ si `planned` ET zéro preuve (0 photo, 0 checklist cochée, 0 anomalie) | — | ✅ sinon : statut `cancelled` À CRÉER (enum, mig) avec raison | Le skip dit « on n'est pas passé » (info métier). L'essai de Guillaume dit « ceci n'aurait pas dû exister » — c'est un autre verbe. `cancelled` garde l'historique ; le hard limité aux planned vierges évite le bruit. |
| **Mission** | ✅ si zéro intervention (essai pur) | ✅ sinon (`deleted_at` existe déjà) | — | Supprimer une mission avec historique détruirait les interventions (FK CASCADE) → interdit. Le soft la retire des listes, l'historique des interventions reste lisible. |
| **Client** | jamais | — | ✅ UNIQUEMENT si aucun site actif ; sinon expliquer le blocage (« 3 sites actifs — archivez-les d'abord ») | `sites.client_id → ON DELETE CASCADE` (mig 003:19) : un hard delete client détruirait sites → missions → interventions → **photos-preuves**. Cascade létale, jamais exposée. |
| **Site** | jamais | ✅ existant (garde de dépendances) | — | Déjà correct : bloqué si historique. Améliorer le MESSAGE (dire quoi, combien, où). |
| **Photo / capture / preuve** | jamais via rangement | (statut `discarded` existant sur visit_capture) | — | La preuve est la valeur économique du produit. Aucun geste de nettoyage ne la détruit. |

## Conditions et comportements (par critère d'acceptation)

- **Confirmation systématique** avec conséquences explicites : « Cette visite et ses
  12 captures seront retirées de vos écrans. Les preuves restent conservées. »
- **Dépendants** : jamais de cascade silencieuse. Client → bloqué si sites ;
  mission → soft si interventions ; réunion validée → soft (actions déjà détachées
  par le mécanisme existant).
- **Restauration** : non exposée en V1 (le soft delete la permet techniquement ;
  un « Récemment retirés » est une amélioration facultative, pas un prérequis).
- **Visibilité historique** : un objet soft-deleted disparaît des listes courantes ;
  ses traces déjà promues (actions, décisions, réserves) restent.
- **Sécurité** : chaque action de retrait = rôle (manager/admin ; visite :
  chef_equipe créateur aussi) + garde org sur l'objet (`tenantOwns`) —
  cf. 04-rls.md : la RLS étant bypassée par le service role, la garde vit dans le code.

## Pièges relevés (à traiter dans les lots)

1. `getActiveVisit` ne filtre pas `deleted_at` (visits.ts:301, choix commenté) — une
   visite retirée peut réapparaître comme « visite active ». À filtrer.
2. Listes réunions filtrent `origin IS NULL` sans `deleted_at`
   (site-reports.ts:140,169,241) — inoffensif tant que hard-only, à aligner AVANT
   d'introduire le soft réunion.
3. Enum interventions sans `cancelled` → migration additive requise (CHECK).
4. Le soft-delete visite ne cascade pas sur `visit_capture` (voulu) — vérifier que
   toute liste de captures passe par un report non supprimé.
