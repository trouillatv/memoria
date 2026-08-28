# P1 — Backlog produit après fermeture P0.5 (recette PETRO)

**Statut : MÉMORISÉ, NON DÉVELOPPÉ.** Ces points sont issus de la recette PETRO et
volontairement **hors P0.5** (P0.5 = cohérence / navigation / vérité uniquement).
Ne rien coder ici avant réouverture explicite de P1.

## Points P1 (à traiter ensemble, pas au fil de l'eau)

1. **Hiérarchie de l'Aperçu** — faire remonter les signaux réellement décisionnels
   (attention, décisions/propositions, retard, évolution) au-dessus des KPI
   secondaires. (Pas de refonte pendant P0.5.)

2. **Densité de « Connaissances validées »** — regroupement / compteurs / dépliage
   par catégories pour réduire la longueur de la liste.

3. **Workflow « À confirmer »** — distinguer décisions / actions / vigilances /
   informations ; éviter qu'un bon fonctionnement du moteur crée une dette de
   validation massive. (Lié : distinguer clairement proposition vs action déjà
   matérialisée — cf. item 3 recette : « Finaliser la sécurisation (cadenas) »
   proposition ≠ action ouverte, deux objets réels du même sujet canonique.)

4. **`lastMeaningfulChangeAt` vs « dernière observation »** — rendre la distinction
   compréhensible pour l'utilisateur **sans modifier la doctrine métier**.

5. **Sémantique des chaînes VISITE → ACTION → PREUVE** — une « action clôturée »
   n'est pas nécessairement une preuve au sens fort ; clarifier origine / action /
   état / preuve / causalité.

6. **État vide de l'onglet PV** quand un chantier (ex. PETRO) a 0 PV historique
   mais des visites terrain : expliquer pourquoi la vue est vide et orienter vers
   Évolution / Lignes de vie. (Cohérent avec P0.5-Vérité : imports ≠ visites.)

7. **Raffinement Évolution + typologie des sujets** — seulement après fermeture
   P0.5 (typologiser les « Sujets suivis » du Patrimoine : personne / organisation
   / sujet, au lieu d'un même objet « cerveau »).

## Doctrine de traitement
Ces éléments entrent dans « une véritable optimisation produit » : les traiter
groupés, pas opportunistement. La couche de vérité (occurrence-first, imports ≠
visites terrain, action « en retard » canonique) est stabilisée et ne doit pas
être rouverte pour ces points.
