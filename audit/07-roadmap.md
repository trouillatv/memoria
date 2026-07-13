# 07 — Roadmap d'exécution (vague « adoption »)

> Plan fondé sur les audits 01→06 (faits, fichier:ligne). Chaque lot = une PR
> autonome : code + tests + CI verte + merge + déploiement + preuve.
> **Règle d'arrêt : si un fait découvert en cours de lot contredit ce plan, on
> interrompt et on révise le plan avant toute modification.**

## Hors périmètre (assumé)

- Planning cyclique (PlanningTemplate→Cycle→Occurrence) : optimisation métier, pas
  une condition d'adoption — Guillaume a commencé SANS. À concevoir depuis son
  usage réel, chantier séparé (l'état actuel/cible est documenté dans 01-model.md).
  **Après la vague : quelques semaines d'usage réel, puis un document « Planning
  v2 — ce que Guillaume a réellement fait » (jamais « ce que nous imaginons ») —
  application directe de la doctrine « l'usage observé, jamais une hypothèse
  seule ».**
  **Constats terrain déjà gravés pour ce futur RFC (photo du planning réel
  Servinor, 2026-07-13) — des intrants, pas des specs :**
  - Guillaume ne planifie pas des tâches, il planifie des **présences** :
    par agent, deux états (Travail / Repos), en rotation. Il pense
    « rotation d'équipes », pas « interventions ».
  - Son modèle mental : Agent → calendrier de présence → les missions du
    jour s'en déduisent. Objet pressenti : **Affectation** (agent, chantier,
    équipe, période, modèle horaire) — c'est l'affectation qui se répète,
    pas le planning.
  - Il ouvre le planning PAR MAGASIN (« Discount Pointière → qui travaille
    aujourd'hui ? ») : mode **site-centrique**. D'autres métiers (BTP,
    maintenance, SAV) seront **agent-centriques**. Un seul moteur, deux
    vues principales — ne pas figer un seul mode.
- Import WhatsApp groupé, analyse multi-documents AO : chantiers séparés, audits propres.
- Restauration exposée (« Récemment retirés ») : le soft-delete la permet, on ne la
  construit pas en V1.
- Renommages structurels client/site (client_id nullable, FK contracts.client_id).
- **Observation gravée (revue ChatGPT+Vincent 2026-07-13, à ne pas oublier) :
  Guillaume pense naturellement en TROIS niveaux — organisation → dossier →
  lieu (Servinor → Discount Pointière → Magasin ; AGP → P3 Titi → Cuisine).
  Le modèle actuel en a deux (client → site) et le dossier d'opportunité
  (mig 172) porte déjà l'identité d'opération. On ne développe RIEN
  maintenant ; on observe son usage réel avant toute décision de modèle.**

## Les lots, dans l'ordre

> Ordre révisé 2026-07-13 (revue ChatGPT, validée Vincent) :
> **R ✓ → V ✓ → X → Y → S → D → C → P.** Deux lots ajoutés (X, Y) ; D passe
> avant C (le nettoyage débloque les tests de Guillaume, la clarification
> des sélecteurs vient ensuite). Lot M ajouté le même jour (constat terrain
> Guillaume) : sa phase 1 est livrée hors ordre car triviale et débloquante ;
> ses phases 2-3 s'insèrent après Y.
>
> **Plan ChatGPT « 16 lots » (2026-07-13)** : même matière, découpage plus
> fin — correspondance : lots 1-2 ≈ X, lot 3 ≈ C, lot 4 ≈ P/Y, lot 5 ≈ D,
> lot 7 ≈ V (✓), lot 8 ≈ M (ph.1 ✓), lots 9-10 = multi-entités/rôles
> (nouveaux, gated pilote), lots 11-14 = planning métier (⚠ liés au futur
> RFC Affectation — ne pas construire les cycles avant), lot 15 = AO
> multi-documents (backlog existant). **PR 1 livrée** (continuité fiche
> chantier → planificateur, cf. ci-dessous) = cœur des lots 0-1-2.
> L'audit Lot 0 a aussi établi : les équipes sont org-level (aucun lien
> chantier dans le schéma — la spec « équipe rattachée au chantier » décrit
> un modèle qui n'existe pas), et `missions.site_id` est en ON DELETE
> CASCADE (mig 018, pas RESTRICT comme le disait 02-dependencies) — preuves
> d'intervention détruites en cascade, à traiter au lot D.

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

### Lot X — Continuité du contexte (ajouté 2026-07-13) — LIVRÉ (PR #122)
> Fiche chantier → « Planifier » → `/semaine?site=<id>` : le planificateur
> s'ouvre prérempli sur ce chantier. Les 6 revalidations croisées manquantes
> sont posées. Isolation org des options du planificateur (elles étaient
> cross-tenant). En-tête de ligne « Client · Contrat » dans la grille.
> Constat majeur de l'audit : le contexte n'était pas « perdu » — le parcours
> « Planifier depuis la fiche chantier » **n'existait pas**.
> Reste : le même geste côté MOBILE (absent).

### Lot X (spec d'origine)
Généralisation du Lot R. Le vrai bug observé n'est pas seulement « ça ne se
rafraîchit pas » mais « **les objets nouvellement créés ne vivent pas dans le
contexte courant** » (je crée une mission → retour semaine → absente ; je crée
une équipe → retour → refresh manuel).
- Règle : tout objet créé (mission, équipe, intervenant, client, site,
  chantier) doit — sans action manuelle — (1) apparaître immédiatement,
  (2) rester SÉLECTIONNÉ dans le formulaire appelant, (3) conserver le
  contexte courant (chantier, semaine, filtre).
- Passer systématiquement chaque point de création : les six objets × leurs
  écrans d'origine (semaine, missions, équipes, mobile, contrat).
- Critère : plus aucun « je crée, je reviens, il n'y est pas » ni « je dois
  re-sélectionner ce que je viens de créer ».

### Lot Y — Navigation sans rupture (ajouté 2026-07-13) — PARTIEL (PR #123)
> Livré : « + Nouvelle mission » INLINE dans le planificateur (fin du cul-de-sac
> « créez-en une depuis un contrat actif »), la mission créée est visible et
> SÉLECTIONNÉE sans quitter l'écran. Bug de fond corrigé au passage : un
> chantier sans contrat (`contract_id` nullable) exposait ZÉRO mission au
> planificateur (jointure `!inner` sur `contracts`).
> Reste : équipe/intervenant inline, et la re-sélection dans les AUTRES
> formulaires (le pattern est posé : `mergeMissionOptions`).

### Lot Y (spec d'origine)
Le film de la session = allers-retours permanents (créer équipe → retour →
créer mission → retour → créer intervenant → retour → refresh).
- Principe : **créer → rester → objet créé sélectionné**. L'utilisateur ne
  quitte presque jamais son écran ; les créations satellites se font inline
  (pattern « + Nouveau client » de CreateSiteDialog:254-296).
- Absorbe le MÉCANISME du Lot P (création inline mission/équipe) ; ce qui
  reste au Lot P = la détection des prérequis annoncés d'un coup (et
  l'intervention « équipe à définir »).

### Lot M — Import de preuves (ajouté 2026-07-13, constat terrain Guillaume)
Constat : « Visite → Importer → gestionnaire de fichiers → où sont mes vocaux
WhatsApp ? ». Le vrai problème n'est pas « WhatsApp est caché » mais
**« l'utilisateur ne sait pas où Android a rangé ses fichiers — et on ne doit
pas le lui demander »** (Scoped Storage : les médias WhatsApp vivent sous
`Android/media/com.whatsapp/...`, en sous-dossiers datés).
Cause dans le code : `ImportVisit.tsx` utilisait UN input avec `accept` mixte
(`image/*,video/*,audio/*,application/pdf`) → Android retombe sur le
gestionnaire de fichiers générique au lieu des sélecteurs de médias.
- **Phase 1 — LIVRÉE 2026-07-13** : un bouton PAR type de preuve (Photos /
  Vidéos / Vocaux / Documents), chacun avec son `accept` PUR → Android ouvre
  le Photo Picker ou le sélecteur audio (où WhatsApp apparaît) sans naviguer
  dans l'arborescence. Vocabulaire : « Ajouter des preuves ». Export WhatsApp
  .zip conservé comme voie séparée (la reconstruction chronologique reste
  la voie riche).
- **Phase 2** : après sélection → rattacher à une visite EXISTANTE (pas
  seulement créer une visite) + commentaire + créer action/réserve. C'est là
  que « Ajouter des preuves » remplacera vraiment « Importer une visite ».
- **Phase 3** : Web Share Target (PWA) — depuis WhatsApp : Partager → MemorIA
  → choisir chantier/visite. L'utilisateur ne quitte jamais WhatsApp.
  Nécessite manifest `share_target` + réception POST ; à tester sur le
  téléphone de Guillaume avant de généraliser.
- Critère : plus jamais un utilisateur en train de chercher un `.opus` dans
  les dossiers système.

### Lot S — Gardes d'appartenance sur les ÉCRITURES — LIVRÉ 2026-07-13 (PR #124)
- **Point d'entrée unique** : `requireOwned(role, table, id)`
  (`lib/auth/ownership.ts`), appelé APRÈS la garde de rôle. La DÉCISION est
  isolée dans `lib/auth/ownership-policy.ts` — pure, 8 tests : admin =
  super-admin plateforme (seule exception) ; objet inexistant et objet
  étranger renvoient le MÊME message (pas d'oracle d'existence) ; appelant
  sans org = refus fail-closed ; objet orphelin (`organization_id` null) =
  refus explicite.
  > Choix assumé vs la spec initiale (`securedAction()` enveloppant le
  > handler) : le wrapper aurait imposé de réécrire ~30 signatures d'actions
  > d'un coup. Une ligne de garde par action donne la même propriété avec un
  > diff relisible. Le jour où l'on veut rendre l'oubli IMPOSSIBLE (et pas
  > seulement visible), le wrapper reste la bonne cible.
- Les 6 surfaces de 04-rls.md §IDOR sont couvertes : les 12 actions
  `intervention-actions.ts`, les 4 actions `/semaine` (dont l'équipe cible de
  la réassignation), `createMissionAction` (2 chemins), création
  d'intervention côté contrat, les 6 actions d'équipe mutant par `teamId`,
  companies, et le terrain (`startVisitAction`, `importVisitAction`).
- **Non testé cross-org réellement** : la CI ne fait tourner que les tests
  unitaires (la garde est prouvée à sec, pas contre deux vraies organisations).
- Règle pour la suite : toute NOUVELLE action qui mute un objet par id
  appelle `requireOwned`.

### Lot C — « Un site ne s'affiche jamais sans son client »
- Ajouter le join `client:clients(name)` aux sources qui ne l'ont pas
  (06-client-site.md §B : listMeetingSitesAction, m/chantiers, meetings/page,
  missions/page, litige) puis rendu unifié `{site} — {client}` dans les 13
  sélecteurs/listes inventoriés. Badge client sur la fiche mobile.
- **Ne pas surcorriger** (précision Vincent) : l'invariant est « le client est
  toujours visible », pas un rendu unique — sélecteur = « Site — Client »,
  fiche = titre + badge client. La présentation s'adapte au contexte.
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
- **« Retirer » n'est jamais ambigu** (précision Vincent) : la conséquence est
  toujours dite selon l'objet — retiré des vues courantes / archivé / annulé /
  preuves conservées. L'utilisateur ignore la mécanique, jamais le devenir de
  ses données.
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
