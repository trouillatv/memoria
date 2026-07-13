# 13 — PL3 : cartographie de la vue planning (avant d'y toucher)

> Contrainte produit : **la vue `/semaine` existante est conservée. PL3
> l'ENRICHIT, il ne la remplace pas.** Ce document cartographie ce qui existe et
> dit, fichier:ligne, **où exactement** le signal s'injecte — au minimum.
> **Aucune ligne de code PL3 n'a été écrite.**

## La bonne nouvelle : PL3 est une SURCOUCHE, pas une refonte

Deux constats décisifs :

1. **La vue `/semaine` ne lit que la table `interventions`** — jamais les
   modules PL1/PL2 (`projection.ts`, `closures.ts` ne sont importés nulle part
   par `/semaine`). Elle n'affiche donc **que du matérialisé**.
2. Le canal d'injection d'un signal **par (site, jour) existe déjà** et n'attend
   qu'un `kind` de plus : `daysBySite` → `dayEvents` → `CellDayEventIcons`.

**Conséquence : le drag-and-drop n'a PAS besoin d'être touché.** La question
« occurrence projetée vs matérialisée » **ne se pose pas dans la vue semaine** —
elle ne se posera que dans la future **vue mois**, là où elle appartient.

## Le coût réel de l'injection

**7 fichiers touchés, ZÉRO ligne existante modifiée** — que des **props
optionnelles** et des blocs conditionnels.

### (a) Le badge sur la cellule

Le canal existe : `page.tsx:255` (`getWeekOperationalSignals`) →
`page.tsx:267-275` (`daysBySite`) → `WeekGrid.tsx:109` → `:163` →
`WeekGridCell.tsx:327` (`<CellDayEventIcons events={dayEvents} />`).

Deux options :

| Option | Coût | Effet |
|---|---|---|
| **A — zéro nouvelle prop** : ajouter `kind: 'closed'` à `WeekDayKind` et 3 lignes dans `CellDayEventIcons` (priorité, icône, nom) | 2 fichiers | Une icône 12 px en bas-à-droite, tooltip gratuit. **Discret — peut-être trop.** |
| **B — prop dédiée** `closuresBySite` (optionnelle) | 4 fichiers | Un badge visible en **`top-1 left-1`** (zone **libre** : `top-1 right-1` = 🔒 `Lock`, `bottom-1 right-1` = icônes d'événements) |

**Recommandation : B** — un conflit doit se voir. Mais A reste possible si tu
veux le minimum absolu.

### (b) Le bloc « Conflit de planning » dans l'aperçu

`CellDrawer.tsx` a déjà une section **« Mémoire du lieu »** (l.196-207) avec
rendu conditionnel et silence positif. Le bloc conflit se pose **entre les
lignes 207 et 209**, comme sa **section sœur**, en réutilisant sa structure
exacte. L'altitude est la bonne : une fermeture est une propriété
**(site × jour)**, et le drawer est un objet **(site × jour)**.

L'aperçu propose déjà « changer l'heure » et « réassigner l'équipe ». Le
déplacement, lui, **se fait au drag** — il n'a jamais eu de bouton, et il n'en
aura pas.

## Trois choses que je dois te dire

### 🔴 1. Le drag-and-drop n'est PAS testé — du tout

`tests/components/week-grid.test.tsx` (486 lignes) ne contient **aucun**
`DndContext`, **aucun** événement de drag, **aucun** mock de `@dnd-kit`. Les
cellules y sont rendues **hors** contexte dnd-kit.

**Le critère « les tests du drag-and-drop restent verts » ne garantit donc
rien** : il n'y a rien à casser côté tests, et donc rien qui protège. La vraie
protection sera de **ne pas toucher au DnD** — ce que permet la surcouche.

### 🔴 2. Un badge cliquable déclencherait un drag fantôme

Le `<td>` est **draggable ET droppable en même temps**
(`WeekGridCell.tsx:239, 267`). Tout élément interactif ajouté dedans démarre un
drag au `pointerdown`. Deux précédents à imiter : le bouton du drawer fait
`onPointerDownCapture={(e) => e.stopPropagation()}` (`:281`), et le `<Lock>` est
en `pointer-events-none` (`:319`).

→ **Le badge de fermeture sera `pointer-events-none`** (tooltip seulement). Les
gestes vivent dans le drawer.

### 🟠 3. On peut déjà déposer une intervention SUR un jour fermé, sans rien dire

`moveInterventionToDayAction` **ne consulte jamais `site_closures`**. Le drag
laisse déposer sur une fermeture en silence.

Conforme à la doctrine (« indicatif, **jamais bloquant** » —
`week-operational-signals.ts:20-24`), la bonne réponse **n'est pas un refus**
mais un **avertissement dans le toast** : *« Déplacé au 15 — attention, le site
est fermé ce jour-là. »* Le geste passe ; l'humain sait.

## Deux règles de non-régression, tirées du code

1. **Jamais de champ REQUIS ajouté à `WeekInterventionCell`** : `makeCell`
   (`tests/components/week-grid.test.tsx:45`) construit un objet complet typé —
   un champ requis de plus **casse la compilation des ~20 tests du fichier**.
   Tout nouveau champ (`template_id`, `origin`, `closure`) sera **optionnel**.
2. **La donnée descend dans DEUX arbres** (`WeekGrid` pour le rendu ;
   `WeekGridClient`/`CellDrawer` pour le DnD et l'aperçu) depuis le même `rows`.
   Une fermeture doit descendre **dans les deux**, sinon la grille et le drawer
   divergeront.

## Deux dettes préexistantes, constatées (à ne pas aggraver)

- `pickTopDraggable` (`WeekGridCell.tsx:95`) autorise le drag d'une intervention
  `skipped`, mais `onDragEnd` (`WeekGridClient.tsx:188`) le refuse. La branche
  « rattrapage » (`result.rescheduled`) est donc **inatteignable depuis la
  grille** — code mort de fait. Correction : une ligne.
- `DroppableCell.tsx` n'est **importé nulle part** — code mort.

## Ce que devient l'ordre d'exécution

| Lot | Contenu | Touche le DnD ? |
|---|---|---|
| **PL3a** | **Détection seule** : badge sur la cellule (`pointer-events-none`) + bloc conflit dans le drawer. Aucun bouton, aucun geste. | **Non** |
| **PL3-0** | Les deux verrous (dédup créneaux + mig 198 `NULLS NOT DISTINCT`) + `materializeOccurrence` | **Non** (couche serveur) |
| **PL3b** | Les gestes dans le drawer + l'avertissement au drag sur jour fermé | **Un ajout**, aucun remplacement |

PL3a **ne touche à rien** : ni `WeekGrid`, ni les cartes, ni le drag. C'est
exactement la surcouche demandée.

**Aucune ligne de code PL3 n'a été écrite. Ce document attend ta validation.**
