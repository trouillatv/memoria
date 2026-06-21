# Validation — Guillaume navigue-t-il par Sujet ?

**But : valider (ou non) le cœur de MemorIA.** Si Guillaume et Émeline cherchent
spontanément par *sujet / problème / décision* — jamais par *document* — alors le
positionnement « mémoire organisationnelle centrée sujets » est le bon, et tout le
reste de la roadmap en découle. On ne teste pas une feature ; on teste une
**hypothèse de modèle mental**.

> ⚠️ **Piège de validité — à lire avant de lancer.** Les chantiers réels sont
> aujourd'hui à **~0 % de rattachement aux sujets** (KPI « santé de rattachement »).
> Donc une recherche par sujet remonte **vide** — non parce que l'utilisateur ne
> pense pas par sujet, mais parce que rien n'y est rattaché. Un test de
> *navigation* mené tel quel confondrait « ne pense pas par sujet » et « graphe
> vide ». **On scinde donc le test en deux.**

---

## Partie A — Formulation (le cœur, AUCUNE donnée requise)

La plus importante, et la moins chère : on **écoute**, on ne montre rien.

Recueillir **20 vraies recherches** de Guillaume (et d'Émeline), en situation. Pour
chacune, noter **mot pour mot** :
- ce qu'il cherche ;
- **comment il le formule** ;
- ce qu'il ouvre / consulte / ignore ensuite.

Puis classer chaque formulation :

| Type de formulation | Exemple | Signal |
|---|---|---|
| par **sujet / problème** | « pourquoi la porte RF30 n'est pas posée ? » | ✅ pense par sujet |
| par **décision** | « qu'est-ce qu'on a décidé pour les enrobés ? » | ✅ pense par sujet |
| par **document / date** | « le PV du 12 mars » | ⚪ pense par document |

**Critère de validation A :** si une nette majorité des 20 formulations sont par
sujet/problème/décision → le modèle mental est confirmé, **gratuitement**, sans
rien construire ni remplir.

---

## Partie B — Navigation (la vue délivre-t-elle ?) — NÉCESSITE des données

On ne lance B **que sur un chantier rattaché**. Sinon le résultat est ininterprétable.

**Pré-requis :** rattacher une fois, à la main, les sujets d'un chantier réel
(ex. **Parking CCI** : ~1 h, zéro code). Les obligations s'auto-rattachent déjà.

Puis : Guillaume tape **DOE / enrobés / DICT / journal photo / récolement** et on
observe :
- Le bon **sujet** remonte-t-il ?
- La **fiche** (état · cause · décisions · actions · réserves · obligations ·
  échéances · prochaine question) lui suffit-elle **sans rouvrir le CR** ?
- Qu'est-ce qui **manque** ?

**Critère de validation B :** il comprend la situation depuis la fiche, sans
fouiller. (= le critère « écho juste » déjà posé.)

---

## Ce que le test décide ensuite

- **A confirmé** (pense par sujet) → le positionnement est le bon ; la priorité
  devient de **remplir le graphe** (auto-rattachement), pas d'ajouter des features.
- **A infirmé** (pense par document) → on a évité de construire un moteur
  d'auto-rattachement inutile. Retour au modèle.
- **B bon** → la vue Sujet est la bonne porte d'entrée.
- **B pauvre malgré rattachement** → c'est la fiche qu'il faut corriger, pas le
  modèle.

> Règle : **ne pas construire le moteur d'auto-rattachement avant que A+B ne
> confirment que la navigation par sujet est le cœur.** Un seed manuel suffit à
> tester. Filtre Vincent : « quelle décision prend-on grâce à cette info ? » → ici,
> la réponse au test décide s'il faut le moteur.

Cf. [[vue-sujet-unite-memoire]], docs/testing/observation-sujet-terrain.md.
