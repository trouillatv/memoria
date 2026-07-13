# Architecture cible de l'espace Chantier

## Décision centrale

Le chantier est l'objet central de MemorIA.

Les visites, réunions, actions, documents, équipes et éléments de mémoire sont ses objets métier.

Les vues principales `Aperçu`, `Chronologie`, `Planning`, `Documents & preuves` et `Mémoire` sont des façons de regarder ces objets. Elles ne doivent pas créer de nouveaux objets, ni concurrencer les fiches canoniques.

`Recherche` est un outil transverse d'accès à l'information. `Organisation` est une vue secondaire de configuration.

Cette distinction doit guider le desktop et le mobile. Le mobile condense les vues ; le desktop les enrichit. Les deux surfaces partagent le même modèle.

## 1. Modèle métier

### Chantier

Le chantier est un agrégat métier. Il possède une identité, un état, des acteurs, des événements, des preuves et une mémoire.

```text
Chantier
├── Identité
│   ├── nom
│   ├── client
│   ├── adresse
│   ├── statut
│   └── zones / sous-périmètres
│
├── Travail à faire
│   ├── actions
│   ├── réserves
│   ├── blocages
│   └── obligations
│
├── Événements
│   ├── visites
│   ├── réunions
│   ├── interventions
│   └── livraisons / passages
│
├── Preuves
│   ├── documents
│   ├── photos
│   ├── vidéos
│   ├── vocaux
│   └── comptes rendus / PV
│
├── Acteurs
│   ├── équipes
│   ├── intervenants
│   ├── entreprises
│   └── référents
│
├── Mémoire durable
│   ├── à savoir
│   ├── décisions
│   ├── habitudes
│   ├── contraintes
│   ├── risques connus
│   └── continuité humaine
│
└── Organisation
    ├── planning
    ├── rythmes
    ├── missions
    ├── récurrences
    └── paramètres
```

Cette couche ne dépend pas de l'interface. Elle constitue le vocabulaire stable du produit.

### État actuel

L'état actuel n'est pas un objet canonique. C'est une projection calculée à partir des objets du chantier :

```text
État actuel =
actions ouvertes
+ réserves
+ blocages
+ événements proches
+ signaux de présence
+ activité récente
```

Il n'a pas de fiche propre ni de cycle de vie autonome. Il est synthétisé par la vue `Aperçu`.

### Réserve et blocage

Une réserve et un blocage ne doivent pas être fusionnés sans définition.

Une réserve correspond à un écart constaté qui doit être levé : finition à reprendre, nettoyage incomplet, défaut de conformité.

Un blocage empêche ou retarde la poursuite d'une activité : accès impossible, plan manquant, décision client absente.

Modèle cible :

```text
Point de vigilance
├── réserve
├── blocage
└── risque
```

La réserve reste un objet qualité. Le blocage reste un objet opérationnel pouvant affecter le planning. Ils peuvent être affichés ensemble dans `Aperçu`, `Chronologie` ou `Mémoire`, mais leurs cycles de vie ne sont pas identiques.

## 2. Vues principales

La navigation principale de l'espace chantier doit rester limitée aux vues de travail permanentes.

```text
Aperçu
Chronologie
Planning
Documents
Mémoire
```

Le libellé recommandé pour la vue documentaire est `Documents & preuves`.

`Recherche` reste toujours accessible comme outil transverse. `Organisation` vit dans un menu secondaire ou dans les paramètres du chantier.

Le nom du chantier, l'adresse, la recherche et les actions principales restent au-dessus ou autour de cette navigation. Sous la navigation, seul le contenu de la vue change.

### Aperçu

Question résolue :

> Où en est ce chantier maintenant ?

Affiche :

- état actuel ;
- actions urgentes ou proches ;
- réserves et blocages ;
- prochaine visite ou réunion ;
- dernière activité ;
- signaux de présence ;
- raccourcis vers les objets importants.

Actions permises :

- préparer une visite ;
- créer une action ;
- déclarer un blocage ;
- planifier ;
- ajouter une information.

L'aperçu n'est pas exhaustif. C'est une synthèse opérationnelle.

### Chronologie

Question résolue :

> Qu'est-ce qui s'est passé, dans quel ordre et avec quelles conséquences ?

Affiche dans un même flux :

- visites ;
- réunions ;
- interventions ;
- décisions ;
- documents ajoutés ;
- actions créées ou clôturées ;
- réserves ouvertes ou levées ;
- changements d'équipe.

Filtres :

- type d'événement ;
- période ;
- zone ;
- personne ;
- statut.

La frise n'est pas une destination séparée. C'est un mode d'affichage de la chronologie.

### Planning

Question résolue :

> Qui doit faire quoi, où et quand ?

Affiche :

- visites prévues ;
- réunions ;
- interventions ;
- missions récurrentes ;
- équipes affectées ;
- fermetures du chantier ;
- jours fériés ;
- cycles de travail.

Modes d'affichage :

- semaine ;
- mois ;
- cycle ;
- équipe ;
- chantier.

Le planning n'est pas une liste d'équipes. C'est une vue temporelle de plusieurs objets.

### Documents & preuves

Question résolue :

> Où est la preuve ou le fichier que je cherche ?

Affiche une bibliothèque unique :

- photos ;
- vidéos ;
- vocaux ;
- plans ;
- CCTP ;
- PV ;
- comptes rendus ;
- justificatifs ;
- exports.

Avec :

- recherche ;
- filtres ;
- aperçu ;
- origine du document ;
- date ;
- zone ;
- événement lié ;
- auteur ;
- tags.

Les catégories `Photos`, `Plans`, `PV` ou `Justificatifs` sont des filtres, pas des cartes de navigation principales.

### Recherche transverse

Question résolue :

> Retrouve-moi tout ce qui concerne ce sujet sur ce chantier.

Recherche transversale dans :

- visites ;
- réunions ;
- documents ;
- vocaux transcrits ;
- actions ;
- décisions ;
- mémoire ;
- intervenants ;
- zones.

Les résultats sont groupés par objet, pas par écran.

Exemple :

```text
Recherche : "plafond"

Visites
- Visite du 13 juillet

Documents
- Photo plafond cuisine
- CCTP lot décontamination

Actions
- Vérifier la dépose complète du plafond

Mémoire
- Présence possible de résidus après incendie
```

### Mémoire

Question résolue :

> Qu'est-ce qui restera utile même dans trois mois ou pour quelqu'un qui reprend le chantier ?

Affiche :

- à savoir ;
- décisions durables ;
- contraintes ;
- risques connus ;
- habitudes du client ;
- points sensibles ;
- zones ;
- relais humains ;
- synthèse des apprentissages.

La mémoire ne contient pas tout l'historique. Elle contient ce qui mérite de survivre à l'historique.

### Organisation secondaire

Question résolue :

> Comment ce chantier est-il structuré et exploité ?

Affiche :

- identité du chantier ;
- client ;
- zones et sous-périmètres ;
- équipes ;
- intervenants ;
- rôles ;
- missions ;
- cycles ;
- récurrences ;
- paramètres ;
- droits d'accès ;
- rattachements documentaires.

C'est la vue de configuration. Elle ne doit pas avoir le même poids visuel que les vues opérationnelles.

## 3. Objets et vues

Les objets ne deviennent pas automatiquement des onglets principaux.

| Élément | Nature | Conséquence UX |
| --- | --- | --- |
| Visite | Objet | Peut apparaître dans Aperçu, Chronologie, Planning, Documents & preuves |
| Réunion | Objet | Peut apparaître dans Chronologie, Planning, Documents & preuves |
| Action | Objet | Peut apparaître dans Aperçu, Chronologie, Recherche |
| Photo | Preuve | Apparaît dans Documents & preuves, Chronologie, Recherche |
| Frise | Mode d'affichage | Appartient à Chronologie |
| Planning | Vue | Affiche visites, réunions, interventions, équipes |
| À savoir | Type de mémoire | Appartient à Mémoire |
| Équipe | Acteur | Apparaît dans Planning et Organisation |
| Sous-périmètre | Structure | Appartient à Identité / Organisation, filtre d'autres vues |

Cette distinction empêche les doublons actuels entre `Activité`, `Frise`, `Visites`, `Documents`, `Photos`, `Mémoire` et `À savoir`.

## 4. Navigation cible

Navigation stable :

```text
Chantier : DISCOUNT Poindimié
Adresse
Actions principales
Recherche dans ce chantier

Aperçu | Chronologie | Planning | Documents & preuves | Mémoire
⋯ Organisation
```

Règles :

- un onglet change réellement de vue ;
- un lien ouvre réellement un objet ;
- une ancre est présentée comme un sommaire, jamais comme une page ;
- la recherche reste accessible comme outil transverse ;
- `Organisation` reste accessible depuis un menu secondaire ;
- les actions transverses restent accessibles au-dessus ou dans un menu `Ajouter`.

Exemples :

- cliquer sur une visite dans `Chronologie` ouvre la fiche visite ;
- cliquer sur une action dans `Aperçu` ouvre la fiche action ;
- cliquer sur une photo dans `Documents & preuves` ouvre la preuve ;
- cliquer sur une équipe dans `Organisation` ouvre l'équipe ;
- cliquer sur `Frise` change le mode d'affichage de `Chronologie`, pas de section métier.

## 5. URLs canoniques

Les URLs visibles peuvent évoluer, mais le modèle cible est le suivant :

```text
/chantiers/:id
/chantiers/:id/chronologie
/chantiers/:id/planning
/chantiers/:id/documents
/chantiers/:id/memoire
/chantiers/:id/organisation

/chantiers/:id/visites/:visitId
/chantiers/:id/reunions/:meetingId
/chantiers/:id/actions/:actionId
/chantiers/:id/documents/:documentId
/chantiers/:id/equipes/:teamId
```

Le modèle interne peut conserver `site` tant que nécessaire. L'interface doit parler de `chantier`.

## 6. Matrice des vues

| Vue | Question | Objets affichés | Actions |
| --- | --- | --- | --- |
| Aperçu | Où en est-on ? | actions, réserves, événements récents, signaux | préparer, créer, planifier, ajouter |
| Chronologie | Que s'est-il passé ? | visites, réunions, interventions, décisions, documents, clôtures | filtrer, ouvrir, changer de mode |
| Planning | Qui fait quoi et quand ? | visites, réunions, interventions, équipes, cycles | planifier, déplacer, affecter |
| Documents & preuves | Où est la preuve ? | fichiers, médias, comptes rendus, exports | ajouter, filtrer, partager |
| Mémoire | Que faut-il retenir durablement ? | savoirs, décisions, contraintes, risques, relais | ajouter, modifier, rattacher |

Outils et configuration :

| Élément | Rôle | Objets concernés | Actions |
| --- | --- | --- | --- |
| Recherche | Retrouver une information dans tout le chantier | tous les objets du chantier | rechercher, ouvrir |
| Organisation | Configurer la structure du chantier | identité, zones, équipes, missions, cycles, paramètres | configurer |

## 7. Actions transverses

Les actions ne doivent pas être confondues avec les vues.

Actions principales :

- préparer une visite ;
- faire une réunion ;
- créer une action ;
- déclarer un blocage ;
- planifier.

Actions d'ajout :

- ajouter un document ;
- ajouter une photo ;
- ajouter une note ;
- ajouter une information durable ;
- ajouter une livraison.

Ces actions peuvent apparaître dans plusieurs vues, mais leur comportement reste le même.

## 8. Règles de conception

1. Un objet existe une seule fois.
   Il peut apparaître dans plusieurs vues, mais conserve la même fiche et la même URL canonique.

2. Une vue répond à une question utilisateur.
   Elle ne correspond pas à une catégorie technique.

3. Une carte n'est pas automatiquement un lien.
   Une carte peut résumer, alerter ou permettre une action.

4. Les couleurs portent un sens stable.
   - vert : conforme ou terminé ;
   - orange : attention ;
   - rouge : blocage ou urgence ;
   - bleu : information ou planning ;
   - violet : mémoire ou assistance.

5. Mobile et desktop partagent le même modèle.
   Le mobile condense les vues ; le desktop les enrichit.

6. Aucune navigation factice.
   Un onglet change réellement de vue. Un lien ouvre réellement un objet. Une ancre est présentée comme un sommaire.

7. Les catégories deviennent des filtres quand elles décrivent le même objet.
   `Photos`, `Plans`, `PV`, `Justificatifs` filtrent la bibliothèque documentaire. Elles ne sont pas des destinations concurrentes.

## 9. Checklist avant modification

Avant toute modification de l'espace chantier, la PR doit répondre clairement à ces questions :

1. Est-ce un objet, une vue, une action ou un mode d'affichage ?
2. Quelle question utilisateur résout cet écran ou ce composant ?
3. Quelle est l'URL canonique de l'objet ouvert ?
4. Cette information existe-t-elle déjà ailleurs ?
5. Mobile et desktop utilisent-ils le même vocabulaire ?
6. La couleur porte-t-elle un état ou sert-elle seulement à décorer ?
7. Le composant est-il un contenu réel, un résumé, un filtre ou un lien ?

Si ces réponses ne sont pas claires, l'élément ne doit pas être ajouté à la navigation.

## 10. Ce qui doit disparaître

- `Activité` et `Frise` comme destinations séparées ;
- `Visites` comme onglet principal si `Chronologie` les expose déjà ;
- `Photos`, `Plans`, `PV` comme cartes de navigation ;
- `Équipes` comme vue principale si son contenu réel relève du planning ou de l'organisation ;
- `Mémoire du chantier` et `À savoir` comme deux niveaux concurrents ;
- raccourcis qui renvoient vers la même page ou un simple scroll ambigu ;
- cartes colorées utilisées uniquement comme menus ;
- différences de vocabulaire visibles entre `site`, `lieu` et `chantier`.

## 11. Correspondance mobile / desktop

Chaque vue doit être déclinée sur les deux surfaces.

| Vue | Mobile | Desktop |
| --- | --- | --- |
| Aperçu | scénario court, cartes clés, action principale | synthèse plus riche, mêmes intitulés, plus de contexte |
| Chronologie | flux récent, filtres simples | flux complet, filtres avancés, mode frise |
| Planning | prochains éléments et équipe du jour | semaine/mois/cycle, affectations, déplacements |
| Documents & preuves | recherche simple, derniers médias, ajout rapide | bibliothèque complète, filtres, aperçu, partage |
| Mémoire | à savoir et recherche mémoire | mémoire structurée, décisions, contraintes, relais |
| Organisation | résumé replié | configuration complète |

Le mobile ne crée pas de concepts différents. Il priorise ce qui sert sur le terrain.
