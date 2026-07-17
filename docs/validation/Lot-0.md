# Lot 0 — Stabilisation et recette de la Mémoire

**Décision : LOT 0 FERMÉ** — 2026-07-18.

## Objectif

Prouver — pas supposer — que les trois derniers chantiers Mémoire fonctionnent
**ensemble** sur l'environnement réellement déployé, en distinguant strictement le
code présent, les tests, le commit poussé, le commit déployé et le comportement
observé au navigateur.

Commits couverts :

| SHA | Sujet |
|-----|-------|
| `ad58521a` | La Mémoire desktop ignorait la connaissance du chantier |
| `5f3088dc` | La recherche cherchait la question entière comme sous-chaîne |
| `5bb7197c` | Confirmer une décision ou un intervenant ne rafraîchissait aucun écran |

## Anomalies trouvées

1. **Boucle de confirmation coupée.** La Mémoire desktop ne lisait que des
   détecteurs ; elle affichait « aucune information n'a encore été marquée comme
   durable » alors que des propositions existaient. L'Aperçu annonçait « 3 à
   confirmer » et pointait vers `?tab=memoire` — un écran qui ne les montrait pas.

2. **Recherche par sous-chaîne.** `` `%${question}%` `` cherchait la phrase entière
   dans le texte. « Quelles ont été les observations ? » ne correspondait à aucune
   trace → zéro résultat, sans erreur. La recherche ne marchait que si l'on tapait
   déjà le mot exact.

3. **Invalidation manquante après promotion.** `promoteProposal` n'appelait pas
   `invalidateSiteProjection`, contrairement à sa propre doctrine. Les créateurs
   d'objets invalidaient eux-mêmes — sauf `createSiteDecision` et
   `openSiteIntervenant`, muets : promouvoir une **décision** ou un **intervenant**
   ne rafraîchissait aucun écran pendant le TTL de 30 s. Deux défauts secondaires :
   l'invalidation partait *avant* le passage de la proposition à `confirmed` ;
   le chemin `/m/site/{id}/patrimoine` manquait à la liste des routes revalidées,
   ce qui forçait l'écran à rattraper lui-même (deux `revalidatePath` en dur).

## Corrections appliquées

- **Mémoire desktop** branchée sur `getMemoryReview` (read model existant),
  réutilisant le panneau du terrain plutôt qu'une seconde copie. Frontière
  conservée : bornée aux quatre types de la Mémoire (`MEMORY_KINDS`). Section des
  détecteurs renommée (« Ce qui demande une suite »), le nom « connaissances »
  rendu à ce que le chantier sait réellement.
- **Recherche** : `lib/knowledge/query-terms.ts` lit une question de deux façons —
  ses *termes* et le *rayon* qu'elle nomme. Une demande de rayon pure rend le rayon
  entier ; un rayon + un terme filtre ; sans terme ni rayon, rien n'est déversé.
  Le type `site_deadline` entre dans le corpus de recherche.
- **Invalidation** : `invalidateSiteProjection` ajoutée à `createSiteDecision` et
  `openSiteIntervenant` (les deux branches de sortie) ; l'invalidation vit
  désormais dans `promoteProposal`, **après** les deux écritures ; le chemin
  `patrimoine` ajouté ; les deux `revalidatePath` de l'écran supprimés — c'est la
  mutation qui invalide, jamais l'écran.

## Preuves

Trois natures, sur la production (`memorianc.vercel.app`) :

- **Base** — relecture après mutation sur le tenant Démo (site 🧪 Recette) :
  propositions ouvertes 11 → 9, `site_intervenant` BET créé (intervenants 1 → 2),
  `site_deadline` créé (échéances 1 → 2), aucune duplication.
- **Navigateur** — recette lecture seule sur Petro Attiti (Aperçu, Mémoire,
  Travail, Recherche tous cohérents avec la base) ; captures avant/après de la
  cascade sur le tenant Démo (INTERVENANTS 1 → 2, recherche « bureau » retrouve
  l'intervenant BET, « À planifier » 1 → 2).
- **Comportementale** — `tests/lib/promotion-invalidates.test.ts` (9 tests,
  vérifiés en cassant le code : 7 tombent, dont l'ordre). Suite complète : 1355
  tests verts. Typecheck et lint verts.

Cascade observée de bout en bout :
`proposition → confirmation → fait métier → invalidation → Aperçu → Recherche`.

## Doctrine vérifiée

L'Aperçu (`getSiteOverview`) et la Mémoire (`getMemoryReview`) restent des read
models **distincts** mais lisent les **mêmes sources canoniques** :
`listKnowledgeEntries`, `listWatchpoints`, `listDecisionsBySite`,
`listSiteIntervenants`. Aucun écran ne consomme le read model d'un autre.

## Limites connues (non bloquantes)

1. **SHA déployé non lisible.** Le compte Vercel connecté ne voit que le projet
   `canal-cup`, pas `memorianc`. La preuve de déploiement est *fonctionnelle* (les
   trois features tournent en prod), pas le hash. Problème d'accès au tableau de
   bord, plus un problème produit.
2. **Propositions démo invisibles au compte réel.** La zone « À examiner » de la
   Mémoire ne rend pas les propositions du tenant Démo pour un compte d'une autre
   organisation — c'est la garde d'isolation fail-closed qui fonctionne.
   Conséquence de recette : la disparition d'une proposition d'intervenant a été
   prouvée par la base et par le compteur Travail, pas par une capture de la
   Mémoire.

## Suite

Le guide « Comment utiliser la Mémoire ? » produit pour la recette gagnerait à
devenir une aide intégrée (bouton d'aide contextuelle / visite guidée) plutôt
qu'un document externe, pour qu'il évolue avec le produit. Reporté au lot 1.
