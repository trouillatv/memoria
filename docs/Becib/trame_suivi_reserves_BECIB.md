# Trame — Suivi de la levée des réserves (BECIB)

> Établie à partir des 3 éditions réelles (05/12/2025, 19/12/2025, 08/01/2026) du chantier La Cravache,
> rasterisées pour voir la vraie mise en page (l'OCR à plat masquait la structure).

## 0. L'opportunité (le vrai enjeu)

Les 3 PDF sont **le même registre de réserves re-saisi à la main** à chaque visite : les statuts évoluent
(A FINIR → OK ; blanc → A FAIRE → FAIT) et les lignes traitées sont **barrées**. L'automatisation doit donc
gérer **un registre persistant unique** dont chaque visite produit une **édition datée** (snapshot), et non
re-taper la liste à chaque fois.

## 1. Nature du document (≠ le CR)

**Ce n'est PAS la charte du CR.** Pas de logo, pas de bandeaux navy, pas d'en-tête/pied de page.
C'est **un seul tableau bordé sur une page A4** (style Word), extensible (lignes vides en réserve en bas).

## 2. Décision à prendre : charte simple (fidèle) ou harmonisée ?

- **Option A — fidèle (recommandée par défaut)** : reproduire le tableau simple tel quel (c'est ce qu'Émeline
  produit ; léger, lisible, attendu par la MOA).
- **Option B — harmonisée** : ajouter un en-tête léger commun au CR (logo BECIB + projet + cartouche DNS + pied
  de page), en gardant le **corps tableau identique**. À choisir seulement si l'on veut une cohérence visuelle
  client sur tous les livrables.

→ Par défaut : **Option A**. À confirmer avec Émeline.

## 3. Structure du tableau

De haut en bas, le tout dans une **bordure extérieure** unique :

1. **Ligne-titre** (cellule pleine largeur, gras centré) : `SUIVI DE LA LEVÉE DES RÉSERVES - le {dateÉdition}`.
2. Ligne d'espacement.
3. **Ligne d'en-tête** : `Désignation` (gras centré) à gauche + une **colonne droite étroite** pour le statut
   (l'original laisse son en-tête vide ; on peut la titrer « Statut » ou la laisser vide pour rester fidèle).
4. **Sections par catégorie** (ligne pleine largeur, gras, alignée à gauche) :
   - `Réserves`
   - `Réserve liée au parfait achèvement`
5. **Lignes de réserve** : puce `-` + désignation (colonne gauche, large) | **statut** (colonne droite).
   Séparateur de ligne en **pointillés** (la bordure extérieure reste pleine).
6. **Sous-notes / observations** : lignes en retrait sous une réserve, **en italique**, sans puce ; peuvent porter
   leur propre statut/échéance à droite (ex. « Le MOA veut bien accorder un peu de temps… » → « janv-26 »).
7. **Note photos** : `PHOTOS du site le {datePhotos} ci-joint.` (ligne dans la catégorie Réserves).
8. **Lignes vides** en bas (séparateurs pointillés) : réserve d'espace pour ajouts futurs.

## 4. Conventions visuelles (à respecter scrupuleusement)

- **Barré = levée.** Une réserve dont le statut vaut OK / levée / FAIT clôturée est **rendue barrée**
  (strikethrough) sur toute sa désignation. Une réserve **ouverte n'est pas barrée**.
- **Statut en colonne droite**, aligné à droite, **en gras**.
- **Couleur** (spécifique à ce document, contrairement au CR) : les items **« Attention »/urgents** sont en
  **gras coloré** (vert/rouge selon l'original) ; un statut critique ou une échéance peut être coloré
  (ex. `FAIT` rouge, `janv-26` rouge). → Ici la couleur **fait partie de la charte**, ne pas la neutraliser.
- **Italique** : notes et observations (qui ne sont pas des réserves formelles).
- **Gras** : items d'attention + en-têtes de catégorie + ligne-titre.
- **Séparateurs de lignes en pointillés** ; **bordure extérieure pleine**.
- Police **sans-serif type Arial** (à confirmer à l'échantillon : l'original est un export Word en Arial).

## 5. Modèle de données — registre vivant + édition datée

```
SuiviReserves {
  meta: { projet, chantier, moa, moe: 'BECIB', dns?, dateEdition, numeroSuivi? }
  categories: [
    {
      nom: 'Réserves' | 'Réserve liée au parfait achèvement',
      items: [
        {
          id,                       // identité STABLE de la réserve (clé du registre)
          designation,              // texte de la réserve
          statut,                   // enum (voir §6)
          levee: boolean,           // true → rendu BARRÉ + statut levée
          echeance?,                // ex. "janv-26", "Février 2026 ?"
          responsable?,             // ETV / MOA / CLUB / MOE…
          attention?: boolean,      // true → gras coloré
          observations?: [          // sous-notes en italique
            { texte, statut? }
          ]
        }
      ]
    }
  ],
  photoNote?: { date }              // "PHOTOS du site le {date} ci-joint."
}
```

Principes :
- **`id` stable** : on maintient UN registre ; on ne re-tape pas la liste à chaque visite.
- **Une édition = un rendu** à `meta.dateEdition` ; on ne change que les statuts/levées + la date.
- **`levee: true`** pilote le barré et le statut « réserve levée / OK ».
- Conserver idéalement un **historique par item** (date de levée) pour tracer l'évolution entre éditions
  — c'est l'info qui distingue tes 3 PDF.

## 6. Vocabulaire des statuts (enum)

`OK` · `FAIT` · `à faire` · `à finir` · `RAS` · `levée` (« réserve levée ») · `OK - DOE`
· `en attente` · responsable seul (`ETV`…) · `échéance` (date, ex. `janv-26`).

> `OK` / `levée` / `FAIT clôturée` ⇒ ligne barrée. `à faire` / `à finir` / `en attente` ⇒ ligne **non** barrée.

## 7. Lien avec le CR (intégration)

Le CR a une rubrique **« Réserves / points bloquants »**. Ce suivi est le **registre dédié** des mêmes réserves.
Idéalement : **une seule source de réserves** alimente à la fois la rubrique du CR et le suivi autonome
(une réserve ouverte en réunion apparaît dans le suivi ; sa levée se reflète des deux côtés).

## 8. Méthode pour Claude Code

1. Rasteriser une édition réelle et **calquer** : bordure extérieure, séparateurs pointillés, 2 colonnes,
   ligne-titre, en-têtes de catégorie.
2. Modèle de données (§5) + une **fixture = une des 3 éditions reconstruite** ; si le rendu la reproduit
   à ~1:1 (barrés inclus), la trame est juste.
3. Implémenter le **barré automatique** piloté par `levee`, et la **colorisation** des items `attention`.
4. Vérifier au flux PDF (réutiliser `inspect-cr-becib.ts`) : pas de cellule qui déborde, séparateurs corrects.
5. Bonus : générer 2 éditions à 2 dates depuis le **même registre** pour prouver le snapshot daté.

## 9. Prompt prêt à coller

```
Nouveau document : « Suivi de la levée des réserves » (≠ le CR). Je fournis 3 éditions réelles
(05/12/2025, 19/12/2025, 08/01/2026) du chantier La Cravache et la trame
« trame_suivi_reserves_BECIB.md ».

Nature : un seul tableau bordé A4, style Word — PAS la charte du CR (pas de logo/bandeaux/pied).
Rasterise une édition et calque la mise en page.

Conventions à respecter :
- BARRÉ = réserve levée (piloté par un booléen `levee`) ; réserve ouverte non barrée.
- Statut en colonne droite (gras, aligné à droite) : OK / FAIT / à faire / à finir / RAS / levée /
  OK - DOE / échéance (ex. « janv-26 »).
- COULEUR conservée ici (contrairement au CR) : items « Attention »/urgents en gras coloré (vert/rouge),
  statut/échéance critiques colorés.
- Notes/observations en italique, en retrait, sous la réserve.
- Bordure extérieure pleine, séparateurs de lignes en pointillés. Lignes vides en réserve en bas.
- Catégories : « Réserves » et « Réserve liée au parfait achèvement ».
- Note photos : « PHOTOS du site le {date} ci-joint. »

Données : registre VIVANT — un `id` stable par réserve, une édition = un snapshot daté (`meta.dateEdition`),
on ne re-tape pas la liste. Schéma dans la trame §5 ; valide la sortie avec Zod + défauts (jamais inventer).

Méthode : (a) calque visuel sur l'édition rasterisée ; (b) modèle + fixture = une des 3 éditions reconstruite,
rendu comparé ~1:1 (barrés inclus) ; (c) vérifie au flux PDF avec inspect-cr-becib.ts ; (d) prouve le snapshot
en générant 2 dates depuis le même registre.

Avant de coder : confirme-moi le schéma JSON, et dis-moi si on reste en tableau simple (fidèle) ou si on ajoute
l'en-tête léger commun au CR (à trancher avec Émeline).
```
