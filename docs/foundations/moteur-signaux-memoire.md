# Moteur d'états de mémoire & dashboard éditorial

> Snapshot 2026-05-22. Fait suite à `qualite-dapparition.md`, `doctrine-design-ux.md`, `risque-deux-morts-opposees.md`. Cristallise la refonte du `/dashboard` en surface éditoriale et la naissance du **moteur de surfaçage** (« Temps 2 »).

---

## 1. Le constat de départ

Le dashboard manager ressemblait encore à un **ERP enrichi** : ~12 widgets empilés, tous au même poids visuel, plusieurs systèmes cognitifs mélangés (mémoire vivante / vigilance / KPI business / AO). Le manager ouvrait la page et devait **réfléchir** pour comprendre ce qui méritait son attention. Un bon dashboard fait l'inverse : il calme, oriente, fait émerger, réduit l'incertitude.

Définition produit retenue, qui gouverne tout le reste :

> **MemorIA ne doit pas occuper l'écran. Il doit apparaître au bon moment, puis se retirer.**

Le dashboard n'est ni un cockpit, ni un centre de contrôle, ni un tableau de performance. C'est une **surface de conscience opérationnelle**.

---

## 2. La séparation cardinale : Temps 1 / Temps 2

Le piège mortel ici est conceptuel, pas technique : dès qu'on commence à faire « parler » le système, on crée une ontologie et une philosophie d'attention. Si elle dérive, on reconstruit un ERP « intelligent ».

On a donc séparé strictement deux chantiers :

- **Temps 1 — la coquille éditoriale** : réordonner, hiérarchiser, supprimer, faire respirer. Ne montrer **que ce qu'on sait vraiment**. Aucun faux intelligent.
- **Temps 2 — le moteur de surfaçage** : « quand quelque chose mérite-t-il d'émerger ? ». C'est le cœur intellectuel.

Règle de discipline : **ne jamais simuler le Temps 2 dans le Temps 1**. Pas de « revient pour la 3ᵉ fois », pas de corrélation devinée, pas de hiérarchie de rareté tant que le moteur ne les calcule pas réellement — sinon le système ment, et détruit la confiance que le silence assumé lui gagne.

---

## 3. Temps 1 — le « collapse » du dashboard (4 zones)

1. **Hero « Mémoire active ce matin »** : UN message principal (+1 secondaire max), ou **silence vert assumé** (« Les lieux sont calmes ce matin »). États possibles : calme / continuité (passation) / AO (échéance) / signalement terrain / résonance mémoire.
2. **« Vie des lieux »** : un **flux unique hiérarchisé**, regroupé en **familles visuelles** (Attention opérationnelle = rouge ; Continuité = ambre ; AO = violet ; Mémoire terrain = bleu doux). Densité variable : signal individuel = ligne normale, résumé = ligne compacte.
3. **Pied** : « Mémoire accumulée : X interventions documentées · Y preuves » (le moat par l'évidence, pas un KPI) + lien discret « Préparer ma défense ».
4. **Navigation contextuelle** : le dashboard **pointe** vers les surfaces spécialisées (déjà dans le menu de gauche) ; il ne les recopie pas.

Supprimés : grosses cartes KPI, widget Pipeline AO, widget « Contrats sous tension », sections contrats, feed d'activité générique. Couleur forte (rouge) **uniquement** pour ce qui menace une continuité ou demande une action (demande terrain de Guillaume).

---

## 4. Temps 2 — la grammaire du moteur

Un **MemorySignal** = un **état observé de la mémoire portée** par un lieu ou une équipe. Explicable, falsifiable, **éphémère** (recalculé à chaque lecture, jamais persisté comme vérité).

Verrous encodés **dans le type** (la doctrine dans le type system) :

- `subjectType: 'site' | 'team'` — **jamais `'person'`**. Impossible de coder un score humain.
- **Pas d'`intensity`/`score`** dans le signal → pas de hiérarchie figée (= score caché), pas d'`escalate()` enfoui.
- **Pas de `text`** → le signal est sémantique ; la phrase FR naît au *renderer* seulement.
- `facts` structurés + `confidence: 'certain' | 'heuristic'` + 2 timestamps (`detectedAt`, `lastRelevantEventAt`) + `evidence { rule, refs }` (auditabilité).

### Les 4 couches (responsabilité unique chacune)

| Couche | Rôle | Règle d'or |
|---|---|---|
| **Détecteur** | reconnaît UN état sur les données réelles | émet des faits, jamais une phrase ni une importance |
| **Collecteur** | `detect → flatten` | ne classe pas, ne décide d'aucune importance |
| **Contextualiseur** (`forSurface`) | filtre (scope) + ordonne + plafonne | « quand parler » **contextuel** à la surface, jamais global |
| **Renderer** | `signal + format → texte/visuel` | pure présentation (FR, lien, couleur, mobile/PDF/vocal) |

Pattern de fichier : `*.logic.ts` (cœur pur, sans `server-only`, testable avec fixtures) + `*.ts` (chargement DB + appel du cœur). Garantit le **déterminisme** (mêmes données + même `now` ⇒ mêmes signaux) et donc des **tripwires**.

---

## 5. L'équilibre santé / fragilité (anti-anxiété)

Le moteur n'est **pas** un moteur d'alertes (ni PagerDuty, ni monitoring). La majorité des signaux doivent être doux, contextuels, rares. Surtout : **les signaux de santé sont de premier rang.** Un système qui ne signale que des fragilités devient une machine à anxiété — la « seconde mort » (`risque-deux-morts-opposees.md`).

Un tripwire **encode** cette doctrine : `santé ≥ fragilité` dans le registre global.

Les 6 premiers détecteurs (mai 2026), tous déterministes, sujet = lieu :

- 🟢 `handover_acknowledged` — une passation a été reconnue (la mémoire a circulé).
- 🟢 `fresh_field_memory` — des « à savoir » notés récemment sur un site.
- 🟢 `continuity_stable` — ≥ 2 équipes connaissent un lieu (relais assuré sur 90 j).
- 🟠 `memory_awaiting` — passation partagée non reconnue depuis > 3 j.
- 🔴 `relay_instability` — ≥ 3 équipes différentes sur un site en 7 j (rotation chaotique).
- 🔴 `unusual_silence` — aucune intervention documentée sur un site depuis > 12 j.

Wording **toujours non-impératif** : « une passation attend une reconnaissance », jamais « X doit lire » ni « manager en retard ». Tripwire dédié (regex) le vérifie.

---

## 6. Résolution de conflits par sujet

Certains signaux s'excluent pour un même sujet : un lieu ne peut être présenté comme « continuité assurée » **et** en « instabilité de relais » (fenêtres distinctes, faits tous deux vrais, message contradictoire). `resolveSubjectConflicts` (dans le contextualiseur, pur + testé) tranche : **la fragilité prime — on ne rassure jamais à tort.**

---

## 7. Ce que la grammaire interdit *structurellement*

- Pas de sujet `'person'` → pas de score humain possible (verrou de type).
- Pas d'`intensity` → pas de hiérarchie implicite figée dans le signal.
- Pas de `text` → pas de narration ERP enfouie dans les détecteurs.
- Le ranking vit dans la surface → pas de file d'alertes globale.
- Signaux éphémères → pas de badge « fragile » périmé qui traîne.

---

## 8. Ce qui reste (volontairement non fait)

- **Batch 2** (déterministe, à seuils/baseline) : `single_team_site`, `orphan_memory`, `aging_memory`, `convergence` (signal positif : une note qui confirme un document).
- **Batch 3** : `memory_contradiction` (note terrain ↔ document) — la seule qui exige une **comparaison sémantique** (`confidence: 'llm'`, garde-fous dédiés). Vrai chantier.
- **Surface planning équipe** : `forSurface({ surface: 'planning', teamId })` + injection des micro-contextes mémoriels sur les créneaux (sujet `team` activé à ce moment). Frontière RH stricte : densité opérationnelle, jamais heures/perf/fatigue.

Le territoire produit que tout ceci dessine : **détecter les états fragiles (et sains) de la mémoire collective** — rupture, changement, silence, récurrence, vieillissement, transmission, contradiction, instabilité. Pas des KPI : des **variations de continuité**.

---

## 9. Liens

- `qualite-dapparition.md` — la grille 6D / `shouldSurface()` que ce moteur incarne.
- `doctrine-design-ux.md` — hiérarchie d'attention, wording, couleur.
- `doctrine-rh.md` — sujet = lieu/équipe, jamais la personne ; périmètres refusés.
- `risque-deux-morts-opposees.md` — sous-intelligence vs surconstruction ; l'équilibre santé/fragilité.
- `doctrine-memoire.md` — silence positif, philosophie de l'oubli, temps mémoriel.
