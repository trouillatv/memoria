# Les métriques reflètent la causalité, jamais l'inverse

> Établie par Vincent le 2026-07-21, au terme du cadrage de la télémétrie de valeur.

> **La structure des métriques doit refléter la structure causale du produit,
> jamais l'inverse.**

## Pourquoi c'est une ligne rouge, pas une préférence

Une fois un tableau de bord construit, ses chiffres acquièrent un statut de
**vérité** : on cesse de les interroger, on décide à partir d'eux. Si leur modèle
causal est faux, toutes les décisions qui en découlent le sont aussi — et
silencieusement, car rien dans la vue ne signale l'erreur. Une vue agrégée n'a pas
de schéma pour la contredire : elle affiche exactement la causalité qu'on lui a
demandé de calculer, vraie ou inventée.

C'est pourquoi la faute la plus dangereuse n'est pas dans le code mesuré, mais dans
la **forme de la mesure**.

## Les trois décisions qu'elle a produites (cadrage 5.1A)

- **Ne pas relier résumé → action.** Techniquement trivial (une colonne
  `ai_run_id`), conceptuellement faux : `visit_summary` et `visit_debrief_extract`
  sont deux runs frères, une action promue ne découle pas du résumé. On ne fabrique
  pas la clé qui rendrait l'indicateur calculable.
- **Deux entonnoirs séparés, jamais un.** Le critère de sortie mesure le résumé
  (affiché / validé / corrigé / abandonné) et la proposition (promue / rejetée /
  sans décision) sur deux questions distinctes. Les fusionner réintroduirait dans
  la vue la causalité que le schéma refuse — au seul endroit où elle serait
  invisible.
- **`source_ai_run_id` repoussé à une tranche dédiée (5.1B).** On n'élargit pas le
  schéma pour rendre un indicateur désiré calculable ; seulement quand une relation
  métier réelle existe et mérite d'être conservée — renseignée à la source, jamais
  par rétro-imputation.

## Le test à s'appliquer avant d'ajouter une métrique ou une colonne

1. Cette relation existe-t-elle **dans le produit**, ou seulement dans le
   tableau de bord que je veux obtenir ?
2. Suis-je en train d'**observer** une causalité, ou de la **fabriquer** pour qu'un
   chiffre devienne calculable ?

Si la réponse à (2) est « fabriquer », la métrique est fausse même si elle compile,
même si elle s'affiche, même si elle paraît utile. Corollaire de
`docs/superpowers/doctrines/demontrer-avant-agir.md` : avant de mesurer une
relation, démontrer qu'elle existe.
