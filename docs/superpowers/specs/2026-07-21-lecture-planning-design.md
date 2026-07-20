# Lecture du planning — design Lot 5

## Intention

Le Lot 5 ajoute une capacité de lecture explicable au planning. MemorIA ne donne pas une recommandation opaque et ne déclenche pas d’action à la place du conducteur : il met en avant un point qui mérite l’attention, expose la chaîne causale qui le justifie et ouvre chaque preuve dans son contexte existant.

Le résultat doit donner l’impression que le planning est devenu capable de se lire lui-même, sans introduire un panneau « IA » reconnaissable comme une fonctionnalité ajoutée après coup.

## Décisions de produit

- Le composant s’appelle `Lecture` dans l’interface et sera conçu comme un composant réutilisable `LecturePanel`.
- La structure commune est :
  1. contexte discret (`Planning · 17 juillet 2026`) ;
  2. phrase courte de priorisation (`Le 17 juillet mérite votre attention.`) ;
  3. `Parce que…` ;
  4. chaîne causale numérotée et ouvrable ;
  5. `Construit à partir de` avec les objets sources ;
  6. lien vers la fiche de preuve (`Voir la fiche du roulement E1 →`).
- Le panneau n’a pas de bouton de création, de chatbot, de texte présenté comme une intuition IA, ni d’action irréversible.
- Chaque preuve ouvre une fiche ou un écran existant, selon les conventions de navigation déjà utilisées dans MemorIA.
- La chaîne doit être courte, démontrable et navigable. Une phrase sans relations vérifiables ne doit pas être affichée comme lecture causale.

Dans l’interface, le libellé reste simplement `Lecture`, au même niveau que `Fiche`, `Historique` et `Relations`. `LecturePanel` est uniquement le nom interne du composant.

## Navigation sémantique

Les vues Mois, Semaine et Jour sont trois résolutions d’une même réalité :

- mêmes KPI, adaptés à l’échelle ;
- mêmes couleurs d’état ;
- mêmes formes de vignettes et mêmes espacements ;
- même grille et mêmes repères métier ;
- même composant `Lecture`, dont le contexte devient plus précis ;
- navigation perçue comme un zoom, pas comme un changement d’application.

Au niveau Mois, la lecture porte sur une date ou un ensemble de tensions. Au niveau Semaine, elle porte sur un jour. Au niveau Jour, elle porte sur une intervention ou une affectation. Le raisonnement reste reconnaissable, mais les preuves deviennent plus fines.

Principe d’architecture : le changement de résolution ne change jamais le langage de l’interface ; seule la granularité des preuves évolue. Une future vue Jour ne doit donc pas réinventer la structure de Lecture sous prétexte qu’elle affiche des objets plus fins.

## Grammaire visuelle obligatoire

La Lecture ne possède aucun langage graphique propre :

- police : Inter, comme le layout et la vue Semaine ;
- la Lecture est composée exclusivement de composants déjà présents dans MemorIA : cartes KPI existantes, séparateurs existants, liens existants, vignettes existantes et primitives de navigation existantes ;
- `LecturePanel` peut orchestrer ces éléments, mais ne doit pas créer une nouvelle primitive visuelle utilisée uniquement par la Lecture ;
- surfaces : `bg-card` / blanc, `border`, rayons et vignettes déjà utilisés ;
- aucune ombre, dégradé, badge ou forme créée spécifiquement pour l’IA ;
- filet latéral discret issu de la couleur de lecture déjà définie dans `app/globals.css` ;
- bleu, vert, rouge/rose, sky et autres couleurs uniquement selon les états métier déjà utilisés dans la grille ;
- les couleurs fortes appartiennent aux preuves, conflits ou états du planning, jamais au conteneur complet de la Lecture ;
- interactions identiques aux objets existants : nom ou lien ouvrable, focus clavier visible, pas de survol comme seul accès.

## Données et confiance

La lecture doit être construite à partir de relations existantes et isolées par organisation. Le bloc `Construit à partir de` affiche des objets ou comptes de preuves compréhensibles, par exemple `1 roulement`, `3 missions`, `2 affectations`. Ces éléments sont des portes vers les sources, pas des métriques de performance.

La confiance est exprimée par la provenance concrète, pas par un score d’IA. Si les sources sont insuffisantes, le panneau reste silencieux ou affiche un état factuel sans causalité inventée.

## Sobriété et stabilité

- Une Lecture ne met jamais en avant plus d’une priorité principale. Les autres observations sont secondaires ou silencieuses ; elles ne forment pas une liste de priorités concurrentes.
- À données et contexte identiques, deux ouvertures successives produisent exactement la même Lecture. Aucun aléatoire, aucune reformulation variable et aucune créativité de surface ne sont autorisés.
- La Lecture est une dérivation déterministe du graphe : mêmes relations, même ordre, même formulation, mêmes preuves.

## Périmètre de la première tranche

La première tranche concerne uniquement le planning et couvre :

- le composant de Lecture et son modèle de données ;
- l’intégration de la Lecture dans les vues Mois et Semaine ;
- la continuité de structure, de couleurs et de navigation entre ces deux niveaux ;
- les liens vers les preuves déjà disponibles, en priorité roulement, missions, affectations et chantiers ;
- les tests de dérivation de la lecture et les tests de rendu/interaction ciblés.

La vue Jour et les lectures de réunions, chantiers ou documents restent des extensions du même contrat, mais ne font pas partie de la première implémentation.

## Critères de réussite

1. En cinq secondes, un conducteur comprend où regarder en premier.
2. Il peut répondre à « pourquoi ? » sans quitter la logique du planning.
3. Chaque étape affichée comme preuve ouvre une source identifiable.
4. La Lecture ne ressemble pas à un assistant ou à une alerte importée.
5. La vue Semaine reste visuellement la référence : aucune nouvelle police, forme, ombre, palette ou interaction spécifique.
6. Les tests vérifient que les relations et la provenance sont organisationnelles, déterministes et silencieuses en cas de preuve insuffisante.
7. Une seule priorité principale est rendue, même lorsque plusieurs signaux secondaires existent.
8. Deux dérivations successives avec les mêmes données produisent une sortie identique.
