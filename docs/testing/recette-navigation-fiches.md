# Recette — navigation entre fiches

> Née comme campagne de validation du prototype Lot 3, cette liste est devenue le
> **contrat fonctionnel** de la navigation entre objets. Chaque cas vient d'un
> comportement réellement observé en production, pas d'une intention.
>
> Candidate à l'automatisation plus tard. Pour l'instant : recette manuelle ou pilotée.

## Les deux intentions, à ne jamais confondre

Le prototype a démontré (mesure prod, chaîne Décision → Action) qu'un seul geste ne
peut pas porter les deux sens :

| Intention | Geste | Comportement attendu |
|---|---|---|
| **Revenir d'un objet** | Précédent du navigateur | remonte d'un maillon ; le panneau **reste ouvert** sur l'objet précédent |
| **Quitter l'espace des fiches** | croix · Échap · clic-dehors | ferme le panneau et revient à l'onglet, **en une fois**, sans réafficher l'objet précédent |

## Parcours de référence

Chantier de démonstration **Petro Atiti**, onglet **Mémoire → Pourquoi ?**
(compte `demo@memoria.nc`).

| # | Étape | URL attendue | Résultat attendu |
|---|---|---|---|
| 1 | Cliquer une **Décision** | `/sites/<id>/decision/<id>?tab=memoire` | panneau ouvert sur la Décision |
| 2 | Suivre « **Produit : …** » | `/sites/<id>/action/<id>?tab=memoire` | panneau ouvert sur l'Action, **même panneau** |
| 3 | **Précédent** navigateur | `/sites/<id>/decision/<id>?tab=memoire` | retour à la Décision, **panneau toujours ouvert** |
| 4 | Revenir sur l'Action, puis **croix** | `/sites/<id>?tab=memoire` | panneau **fermé**, aucune fiche dans l'URL, **la Décision n'est pas réaffichée** |
| 5 | Idem avec **Échap** | idem cas 4 | idem cas 4 |
| 6 | Idem par **clic-dehors** | idem cas 4 | idem cas 4 |

### Contrôles après fermeture (cas 4, 5, 6)

- aucun panneau ne reste monté ;
- le **Précédent** du navigateur **ne rouvre pas** la fiche qui vient d'être fermée ;
- le défilement et l'état de l'onglet sont conservés autant que possible.

### Accès direct et partage

| # | Étape | Résultat attendu |
|---|---|---|
| 7 | Recharger (F5) sur une URL de fiche | **page complète** valide de l'objet, pas d'erreur, pas de panneau |
| 8 | Coller cette URL dans un nouvel onglet | même page complète |
| 9 | Inspecter l'URL d'une fiche ouverte | **aucun** `decision_source`, `action_source`, `from_person`, `action_site` |

## Comportements observés à ne pas régresser

Chacun est né d'un défaut réel, corrigé :

- **Double rendu** — le corps de fiche est partagé entre panneau et page, à une
  exception près : le titre (titre de boîte de dialogue vs `h1`). Rendre le corps
  en page sans `variant="page"` **plante** (`Cannot destructure property 'store'`).
- **Zone parallèle persistante** — *observé dans notre architecture* : après un
  `router.replace(...)` vers l'onglet, la zone a conservé son contenu et le panneau
  restait affiché malgré une URL sans fiche. D'où : l'affichage est piloté par l'URL.
  (Non vérifié comme règle générale du framework — description, pas généralisation.)
- **Restauration par l'historique** — une navigation *arrière* restaure l'état de
  zone précédent ; une navigation *avant* (`push`/`replace`) ne le fait pas. C'est
  pourquoi le cas 4 était vert avec `history.back()` et rouge après la dissociation.
- **Clic avant hydratation** — un clic très précoce part en navigation classique et
  rend la page complète au lieu du panneau. À garder à l'esprit en recette pilotée.

## Hors périmètre de cette recette

**La performance.** Ouverture 2–3 s, suivi de relation ~3,4 s. C'est un chantier
distinct : ne jamais attribuer un gain ou une régression de vitesse à un changement
de navigation. Les deux sujets se mesurent séparément.
