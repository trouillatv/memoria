# 07 — Roadmap d'exécution (vague « adoption »)

> Plan fondé sur les audits 01→06 (faits, fichier:ligne). Chaque lot = une PR
> autonome : code + tests + CI verte + merge + déploiement + preuve.
> **Règle d'arrêt : si un fait découvert en cours de lot contredit ce plan, on
> interrompt et on révise le plan avant toute modification.**

## Hors périmètre (assumé)

- Planning cyclique (PlanningTemplate→Cycle→Occurrence) : optimisation métier, pas
  une condition d'adoption — Guillaume a commencé SANS. À concevoir depuis son
  usage réel, chantier séparé (l'état actuel/cible est documenté dans 01-model.md).
- Import WhatsApp groupé, analyse multi-documents AO : chantiers séparés, audits propres.
- Restauration exposée (« Récemment retirés ») : le soft-delete la permet, on ne la
  construit pas en V1.
- Renommages structurels client/site (client_id nullable, FK contracts.client_id).

## Les lots, dans l'ordre

### Lot R — Rafraîchissement fiable (le plus petit, le plus sûr)
- `NewMissionDialog.tsx` : `router.refresh()` après `{ok}` (LE cas « je crée, rien
  n'apparaît », cf. 04-rls.md).
- `createSiteGlobalAction` : revalider aussi `/clients` quand un client est créé inline.
- `createInterventionAction` (contrat) : revalider aussi `/semaine` et `/missions`.
- `/clients` : `force-dynamic` (aligné sur les autres listes).
- Règle d'or à graver en commentaire : toute mutation revalide TOUS les paths qui
  affichent l'objet.
- Critère : « Actualisation » ✓. Risque : quasi nul. Migration : aucune.

### Lot V — Une visite, une source de vérité (priorité Vincent : mobile/desktop d'abord)
- Rebrancher le débrief desktop `/sites/[id]/visites/[visitId]` sur
  `listVisitCaptures(reportId)` (supprime la reconstruction par fenêtre temporelle,
  `lib/db/visits.ts:1723`) → photos en vignettes, vocaux écoutables + transcripts,
  notes/vérifications réelles. Helpers existants, zéro migration.
- Bloc « Ce qu'il fallait vérifier » (via `listWatchlist`).
- Deux liens sortants : « Ouvrir le CR PDF » (route existante) et « Voir toutes les
  captures » (récap).
- Réutilisation avant doublon : AUCUN nouveau composant si un composant mobile est
  extractible (vignettes, lecteur audio).
- Critère : pertes d'information n°1-5 de 05-mobile-desktop.md ✓.

### Lot S — Gardes d'appartenance sur les ÉCRITURES
- `tenantOwns(ctx, table, id)` en tête de chaque server action mutante (liste
  exacte dans 04-rls.md §IDOR : intervention-actions, création intervention/mission,
  équipes, companies, visites/rapports par site_id). Admin = super-admin exempté.
- Fait AVANT les lots D/P pour que toute nouvelle action naisse avec la garde.
- Tests : unitaires sur les fonctions pures + refus cross-org.
- Critère : « Sécurité » ✓.

### Lot C — « Un site ne s'affiche jamais sans son client »
- Ajouter le join `client:clients(name)` aux sources qui ne l'ont pas
  (06-client-site.md §B : listMeetingSitesAction, m/chantiers, meetings/page,
  missions/page, litige) puis rendu unifié `{site} — {client}` dans les 13
  sélecteurs/listes inventoriés. Badge client sur la fiche mobile.
- Dédup client dans `createClientAction` (ilike org-scopé existant) — warning non
  bloquant.
- Étendre la détection de doublon site (trigram existant) à la création rapide
  mobile et au formulaire contrat.
- Critère : « Sélecteurs » ✓ (deux sites homonymes distinguables).

### Lot D — Le verbe unique « Retirer » (cœur de la vague)
Doctrine 03-delete-strategy.md. Un seul verbe UI, mécanique interne par objet :
- **Migration additive** : `'cancelled'` dans l'enum interventions (le modèle existe
  déjà sur site_actions 099:155).
- **Intervention** : « Retirer » = hard si `planned` et zéro preuve, sinon
  `cancelled` avec raison. (« Signaler qu'on n'est pas passé » = skip, reste distinct.)
- **Mission** : « Retirer » = hard si zéro intervention, sinon soft (`deleted_at`
  existant, jamais écrit). JAMAIS de hard avec historique (cascade preuves,
  02-dependencies.md chaîne n°1).
- **Client** : « Archiver » seulement si aucun site actif ; sinon message explicite
  (« 3 sites actifs — archivez-les d'abord »). Jamais de hard (cascade létale,
  protection actuelle = effet de bord RESTRICT).
- **Réunion validée** : soft (`deleted_at` existant) — le hard reste réservé aux
  brouillons (mécanisme actuel conservé).
- **Visite** : bouton desktop (le soft existe, mobile only) + corriger
  `getActiveVisit` qui ignore `deleted_at` (visits.ts:301) + aligner les listes
  réunions sur `deleted_at` (site-reports.ts:140,169,241) AVANT le soft réunion.
- Chaque geste : confirmation avec conséquences (« … et ses 12 captures seront
  retirées de vos écrans. Les preuves restent conservées. »), garde rôle + org
  (héritée du Lot S), revalidation (règle du Lot R).
- Critères : « Visite », « Réunion », « Intervention », « Client » ✓.

### Lot P — Fin des prérequis cachés
- Fait établi (01-model.md) : seul prérequis DB = la mission ; l'équipe n'est
  requise qu'au démarrage (contrainte 048).
- Semaine `CreateInterventionDialog` : remplacer le texte mort (« Aucune mission
  disponible… ») par une création de mission INLINE — répliquer le pattern
  « + Nouveau client » de CreateSiteDialog (:254-296), sans perdre le formulaire.
- Mobile `InterventionLauncher` : lever le faux prérequis équipe (autoriser
  « Non-affecté » au stade planned) OU « + Nouvelle équipe » inline (le formulaire
  ne demande qu'un nom) ; supprimer le select vide silencieux.
- « + Nouvelle équipe » inline aussi côté semaine.
- Critère : « Prérequis » ✓ (l'utilisateur sait quoi et a une action directe).

## Correspondance critères d'acceptation → lots

| Critère | Lot |
|---|---|
| Visite retirable | D (desktop ; mobile existant) |
| Réunion retirable | D |
| Intervention retirable/annulée | D |
| Client archivable ou bloqué expliqué | D |
| Sélecteurs distinguables | C |
| Prérequis explicites + action directe | P |
| Actualisation fiable | R |
| Sécurité org/rôle | S (+ hérité partout) |

## Ce que les audits ont changé au plan initial

1. Le problème « suppression » est en réalité un problème d'**incohérence de
   langage** → doctrine du verbe unique (Vincent 2026-07-13).
2. La sécurité des écritures (IDOR cross-org généralisé) n'était pas dans la
   demande initiale — elle devient le Lot S, avant les nouveaux gestes.
3. Le desktop ne « manque » pas de fonctionnalités visite : il lit la MAUVAISE
   source. Lot V = rebranchement, pas construction.
4. La protection anti-cascade du client est un effet de bord (RESTRICT missions),
   pas une conception → les gardes vivent dans le code applicatif.
```
