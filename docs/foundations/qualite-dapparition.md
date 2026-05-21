# Qualité d'apparition — La grille à 6 dimensions

> **Pas combien de mémoire. Quand, comment, avec quelle intensité, avec quel niveau d'urgence, avec quel niveau de confiance, avec quelle fatigue cognitive.**

**Date du cadrage** : 2026-05-22 (extension de la discipline d'apparition originelle à 4 questions)
**Statut** : Doctrine étendue. Helper exécutable `shouldSurface()` = sprint futur.

---

## L'observation

La doctrine originelle de la [discipline d'apparition](doctrine-memoire.md#6-la-discipline-dapparition-post-sprint-c) tient à 4 questions binaires :

1. Y a-t-il une vraie incertitude humaine à ce moment ?
2. L'absence de mémoire produit-elle une erreur opérationnelle concrète ?
3. L'humain peut-il AGIR sur ce que la mémoire lui montre ?
4. Le moment choisi est-il rare ?

C'est une bonne **règle d'inclusion / exclusion**. Mais elle ne suffit pas pour **calibrer** un moment qu'on a déjà décidé d'inclure.

L'étape suivante — *« le vrai sujet maintenant n'est pas combien de mémoire, mais quand, comment, avec quelle intensité… »* — pose 6 dimensions à calibrer pour chaque surface.

---

## La grille à 6 dimensions

| Dimension | Question | Mesure / signal |
|---|---|---|
| **1. Quand** | Le moment est-il rare et critique ? | Fréquence d'apparition / session utilisateur |
| **2. Comment** | Bandeau ? Encart ? Lecture ? Brief ? Modale ? | Forme adaptée au contexte d'attention |
| **3. Intensité** | Couleur, taille, position dans la page | Hiérarchie visuelle calibrée |
| **4. Urgence** | Rouge MEDU pour deadline critique ? Sobre pour info ? | Réversibilité de l'erreur si manqué |
| **5. Confiance** | « Pourrait », « écho juste », « confirme » ? | Wording prudent calibré sur la qualité de la source |
| **6. Fatigue cognitive** | Charge totale visible dans la session | Compteur d'éléments + temps déjà passé |

---

## Détail par dimension

### 1. Quand (fréquence)

**Trop fréquent** : la mémoire devient mobilier. L'utilisateur arrête de la voir.
**Trop rare** : la mémoire n'est plus là quand on en aurait besoin.

**Cible** : la fréquence doit être **calibrée sur la rareté du moment opérationnel correspondant**.

Exemples :
- Passage de témoin = ~5/an par équipe → bandeau dashboard rare et précis ✅
- AO à rendre ≤ 7j = ~2-3/mois → bandeau rouge MEDU justifié ✅
- Anomalie nouvelle = ~5/semaine → notification discrète, jamais alerte rouge ✅
- Photo déposée = ~50/jour → silence total, surface uniquement à la demande ✅

### 2. Comment (forme)

Hiérarchie des formes du plus discret au plus interruptif :

1. **Lien dans la nav sidebar** (présence permanente, attention zéro)
2. **Compteur dans la nav** (« 3 ») — signale sans déranger
3. **Encart dans le dashboard** (regroupé avec les autres)
4. **Bandeau en haut du dashboard** (capture le regard à l'ouverture)
5. **Toast / Sonner** (interrompt 3-5s)
6. **Modale** (interruption forcée)
7. **Notification push / email** (sortie de l'app)

**Règle** : chaque cran d'escalade exige un **gain de valeur opérationnelle** mesurable. Pas d'escalade gratuite.

### 3. Intensité (hiérarchie visuelle)

Dans une page donnée, le poids visuel doit refléter la **priorité d'action**.

- **Haut + grand + coloré** = action critique attendue
- **Milieu + moyen + sobre** = information de contexte
- **Bas + petit + gris** = trace consultable, pas de demande

Une page MemorIA bien calibrée a **1 seul élément haut + grand + coloré** au plus. Si deux éléments hurlent en même temps, l'utilisateur ne sait plus lequel traiter en premier.

### 4. Urgence (couleur)

| Couleur | Signal | Cas d'usage |
|---|---|---|
| **Rouge MEDU** (`#C0392B`) | Action critique, erreur grave si ignorée | AO à rendre ≤7j, interventions sans équipe, J-7 continuité |
| **Ambre** | Vigilance, pas critique | J-14 continuité, AO à 14j, anomalie non résolue de 30j |
| **Brand-600** | Action positive ou navigation | Bouton « Préparer la passation », liens cliquables |
| **Slate / Muted** | Information descriptive | Compteurs cumulés, dates, textes de contexte |

**Règle** : le rouge MEDU n'est utilisé **que si une erreur opérationnelle réelle survient si l'utilisateur ignore l'élément** — pas pour faire joli.

### 5. Confiance (wording)

L'IA propose, l'humain valide. Le wording doit refléter le **niveau de confiance de la source** :

| Niveau | Wording | Quand |
|---|---|---|
| **Fait** | « Le contrat se termine le 14 juin » | Source DB directe, vérifiable |
| **Description neutre** | « 3 sites portent une mémoire opérationnelle » | Agrégation factuelle, descriptive |
| **Écho** | « Ce qui revient ici » | Résonance IA, fragment narratif |
| **Hypothèse** | « Pourrait être lié à », « à vérifier » | Lecture cross-store, faible cosine |

Un wording trop confiant sur une source faible **érode la confiance globale**. Un wording trop prudent sur un fait dur fait passer MemorIA pour incertain.

### 6. Fatigue cognitive (charge totale)

C'est la dimension **transverse** : même si chaque surface est calibrée, leur **accumulation** dans une session peut tuer la lisibilité.

Métriques candidates :
- **Nombre d'éléments visibles** sur le dashboard à l'ouverture (cible : 4-7, alerte si > 10)
- **Ratio de pages silencieuses** : combien de pages affichent du contenu IA vs combien se taisent (cible : ~30% silencieuses)
- **Latence du 1er clic utile** : entre ouverture et action significative (cible : <5s, alerte si >15s = utilisateur perdu)

Ces métriques sont à instrumenter dans le **dashboard d'observation pilote**.

---

## Application pratique

Chaque moment de mémoire qui surgit doit avoir un **score sur ces 6 dimensions**. Si un score est aberrant (ex. apparition à fréquence 10x/jour mais marqué urgence rouge), la surface est **mal calibrée** et doit être resserrée.

### Pattern d'analyse

Pour chaque surface visible, écrire :

```
Surface : Widget Pipeline AO sur dashboard
Quand : ~5x/jour si manager actif
Comment : encart dans la section vigilance
Intensité : sobre, 3 chiffres compacts
Urgence : ambre si AO en retard, neutre sinon
Confiance : fait dur (count SQL)
Fatigue : 1 élément parmi 5-7 du dashboard

→ Calibration cohérente. ✅
```

### Helper exécutable (sprint futur)

À terme, on peut encoder la grille comme helper :

```ts
shouldSurface(memoryType, context, sessionLoad): {
  show: boolean
  form: 'banner' | 'card' | 'inline' | 'modal'
  intensity: 'subtle' | 'normal' | 'urgent'
  confidence: 'high' | 'medium' | 'low'
}
```

Si on intègre la grille dans le code, on transforme la doctrine d'une *règle écrite* en *règle exécutable*. C'est cohérent avec le pattern des tripwires CI (encoder l'éthique dans le code).

**Pas urgent** — d'abord observation pilote, ensuite généralisation si nécessaire.

---

## Doctrines liées

- [Doctrine de la mémoire](doctrine-memoire.md) — §6 contient la version originelle à 4 questions
- [Risque deux morts opposées](risque-deux-morts-opposees.md) — la grille sert à rester au centre
- [Primitives produit](primitives-produit.md) — primitive « Limites humaines »
- Memory : [[discipline-dapparition]], [[qualite-dapparition-grille-6d]], [[lien-utile-aide-a-agir]]
