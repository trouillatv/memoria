# P3-A — Audit READ-ONLY : éligibilité à la mémoire longitudinale

Date : 2026-08-27. READ-ONLY. Aucun code, aucune écriture. Doctrine A/B. Site Bella Napoli
(2 runs : 684b982b 2024, 79a735e1 2025). Sources : `_p3-audit.mjs`.

## 1. Matrice des familles de propositions (pipeline réel)

Familles RÉELLES (données) : `knowledge_fact` (20), `company` (13), `person` (8), `observation` (8),
`action` (3), `decision` (1), `deadline` (1). Toutes obtiennent un thread + une identité canonique.

| Famille | Thread | Canonicalisé | Occurrence produite ? | Justification code |
|---|---|---|---|---|
| knowledge_fact | oui | oui | **oui** | dans `ELIGIBLE_FAMILIES` |
| action | oui | oui | **oui** | dans `ELIGIBLE_FAMILIES` |
| decision | oui | oui | **oui** | dans `ELIGIBLE_FAMILIES` |
| deadline | oui | oui | **oui** | dans `ELIGIBLE_FAMILIES` |
| **observation** | oui | oui | **NON** | **absente de `ELIGIBLE_FAMILIES`** |
| company / person | oui | acteur | non (acteur) | hors périmètre métier |

**Défaut de nommage (moteur)** : `ensureHistoricalPdfOccurrences.ELIGIBLE_FAMILIES` =
`{action, vigilance, decision, knowledge_fact, deadline, reservation}`. Or les familles réelles sont
`observation` (jamais `vigilance`) et il n'existe aucune proposition `vigilance`/`reservation`. La
whitelist a été écrite avec des noms de **kind** (`vigilance`) au lieu des noms de **famille**
(`observation`). `reconcile` (FAMILY_TO_KIND) mappe pourtant bien `observation → vigilance` : l'INTENTION
était probablement d'inclure les observations, mais l'occurrence les exclut par ce décalage. C'est un
**bug**, pas une décision métier explicite.

## 2. Matrice de toutes les observations Bella Napoli (8)

| # | Date | Observation | Sujet | Occurrence sur (CS,date) ? | Classe |
|---|---|---|---|---|---|
| 1 | 2024 | Contrôle appareils cuisson à faire — URGENT | Contrôle cuisson | oui (via knowledge_fact) | DUPLICATE partiel / état distinct masqué |
| 2 | 2024 | Contrôle extincteurs à faire — URGENT | Contrôle extincteurs | oui (via knowledge_fact) | idem |
| 3 | 2024 | Contrôle friteuse à faire — URGENT | Contrôle friteuse | oui (via knowledge_fact) | idem |
| 4 | 2024 | Exploitant emprunte le couloir… chainette | Séparation flux | oui (via action) | DUPLICATE / contexte couvert |
| 5 | 2024 | Flux public/personnel doivent être séparés | Séparation flux | oui (via action) | DUPLICATE / contexte couvert |
| 6 | 2024 | Nettoyage conduits à faire — URGENT | Nettoyage conduits | oui (via knowledge_fact) | idem #1 |
| 7 | 2024 | **Registre de sécurité non renseigné (élec.)** | Registre… | **NON (0 occurrence)** | **SHOULD_BE_OCCURRENCE** |
| 8 | 2025 | **Largeur de passage des dégagements réduite** | Largeur réduite (frigos) | **NON (0 occurrence)** | **SHOULD_BE_OCCURRENCE** |

**Constat** : le problème n'est pas « toutes les observations sont perdues ». 6/8 ont leur sujet déjà
rendu visible par une autre proposition. **2/8 sont totalement invisibles** (leur CS n'a aucune
occurrence, car leur unique proposition est une observation). Ce sont les cas nets.

Nuance importante : les 6 « couvertes » masquent un **état daté distinct** (« à faire — URGENT » 2024)
qui n'apparaît pas comme occurrence propre. Mais le modèle actuel produit **une occurrence par
(CS, rapport)** : même en rendant `observation` éligible, l'état « à faire » serait **poolé** dans
l'occurrence existante (evidence_count++), pas exposé séparément. → révèle un **second défaut** (§9).

## 3. Diagnostic « Registre » (SHOULD_BE)

« Registre de sécurité installations électriques non renseigné » 2024 = observation, seule proposition
de son CS. Exclue → CS sans occurrence → **invisible en ligne de vie**. C'est pourtant un **état daté
parfaitement métier** : « en 2024, le registre n'est pas renseigné ». Son inclusion donnerait une ligne
de vie « 2024 : non renseigné » (puis, si un futur PV le renseigne, « → renseigné »). **Correspond au
métier.** Cause = pur défaut d'éligibilité (§1), pas de composite.

## 4. Diagnostic « cuisson » — éligibilité vs composite (à ne pas mélanger)

- 2024 : `knowledge_fact` « Appareils de cuisson contrôlés par Bureau Veritas le 25/03/2022 » →
  occurrence existe sur « Contrôle cuisson ». **Le 2024 est correct.**
- 2024 : `observation` « Contrôle cuisson à faire — URGENT » → même CS, poolée/masquée (état « à faire »
  non exposé) — problème d'éligibilité/pooling, mineur ici.
- 2025 : le « à refaire » cuisson est **dans le composite** « Contrôles électriques, éclairage et cuisson
  à refaire » → rattaché à « Contrôle électrique », **pas** à « Contrôle cuisson ».

⇒ **Cuisson ne traverse pas 2024↔2025 à cause du COMPOSITE**, pas de l'éligibilité. Les deux causes sont
distinctes : l'éligibilité concerne l'état « à faire » 2024 ; le composite concerne le « à refaire » 2025.

## 5. Diagnostic du composite « électrique / éclairage / cuisson »

Proposition `action` 2025 : « Contrôles électriques, éclairage et cuisson à refaire » — **trois objets
métier durables** dans un seul fait (installations électriques, éclairage de sécurité, appareils de
cuisson). Aujourd'hui : matérialisée en **une** occurrence rattachée à **un seul** sujet (« Contrôle
électrique » après P2-A). Éclairage et cuisson restent dans le texte, sans occurrence propre sur leurs
sujets. Options possibles (à établir, pas à décider) :
- (a) **éclatement à l'extraction** en 3 propositions mono-objet (le plus propre en amont) ;
- (b) **une occurrence reliée à N sujets** — mais `canonical_subject_occurrence.canonical_subject_id`
  est **mono-sujet** ; il n'existe aucune table occurrence↔sujets multiples. Nécessiterait un nouveau
  raccord ;
- (c) composite conservé + `canonical_subject_links` entre les 3 sujets — mais links = relations
  causales, pas « ce fait porte sur 3 sujets » ;
- (d) autre. **L'architecture actuelle ne permet proprement que (a).** Un fait multi-sujets n'a
  aujourd'hui aucun mécanisme de matérialisation multi-cible.

## 6. Autres composites détectés

**Aucun autre vrai composite multi-objets.** Les faux positifs de l'heuristique (« Nettoyage conduits
d'air vicié, de buée et de graisse » = un objet avec liste descriptive ; « Signature registre sécurité
(clim, hotte) » = une action ; « Validation issue mall… » = un objet) portent chacun sur **un seul**
objet métier. Le composite électrique/éclairage/cuisson est isolé.

## 7. Impact potentiel d'ouvrir les observations aux occurrences

- **Corrige** : Registre (2024) + Largeur réduite (2025) deviennent visibles → 2 sujets de plus en
  ligne de vie. Enrichit l'état « à faire — URGENT » 2024 sur cuisson/extincteurs/friteuse/nettoyage.
- **Bruit sur Bella Napoli** : ~0 (les 8 observations sont toutes des états datés significatifs).
- **Doublons** : pas de doublon d'occurrence (une par CS/rapport → pooling), mais l'état « à faire »
  serait **fondu** dans l'occurrence existante, pas exposé (cf. §9).
- **Risque Géant** : une ouverture **aveugle** (family=observation → toujours éligible) laisserait
  entrer d'éventuelles observations transitoires/non longitudinales (« il pleuvait », « accès difficile
  ce jour »). Il faut un **critère de signification**, pas une whitelist élargie sans garde.

## 8. Règle conceptuelle recommandée (à tester, pas à décider)

**« Une occurrence représente un état/événement daté SIGNIFICATIF d'un sujet métier durable, pas un
type de proposition. »** Testée contre le corpus :
- **corrige** : Registre, Largeur réduite (états datés réels aujourd'hui perdus) ;
- **n'introduit ~aucun bruit** sur Bella Napoli ;
- **doublons** : gérés par le pooling (pas de duplication d'occurrence) ;
- **doivent rester exclus** : company/person (acteurs, déjà traités) ; et, génériquement, les
  observations **non longitudinales** (transitoires, météo, contexte ponctuel) — d'où la nécessité d'un
  critère de signification, pas d'un simple ajout de `observation` à la whitelist.

Cette règle est plus transverse (Géant, futurs CR) qu'un ajout à une liste : elle déplace la décision
du **contenant** (famille d'extraction) vers le **contenu** (état daté d'un sujet durable).

## 9. Défauts moteur découverts (séparés)

1. **Éligibilité par famille** (`ELIGIBLE_FAMILIES`) : décalage de nommage (`vigilance`/`reservation` au
   lieu de `observation`/famille réelle) → observations exclues des occurrences. Cause des 2 orphelins.
2. **Fait multi-sujets (composite)** : aucun mécanisme de matérialisation multi-cible ; un fait citant N
   objets ne peut alimenter qu'un seul sujet. Cause du non-traversal cuisson + fragmentation éclairage.
3. **Une occurrence par (CS, rapport)** : plusieurs états datés distincts d'un même sujet dans un même PV
   (« contrôlé 2022 » + « à faire urgent 2024 ») collapsent en une occurrence. Limite plus profonde du
   modèle — à ne PAS traiter dans P3 sans décision. Signalé, pas corrigé.

Point 6 de la demande (contradiction éclairage) : **pas une contradiction.** « Éclairage réalisé le
22/03/2024 » (knowledge_fact) puis « à refaire » (2025) = cycle normal **réalisé → échéance → à
refaire**. Le défaut est que les deux états vivent sur deux sujets différents (fragmentation du
composite), pas une incohérence de données. Une mémoire correcte doit représenter ce cycle sur UN sujet.

## 10. Proposition B (workflow) + A (repair) — NON implémentées

**B — workflow futur :**
- **B1 (éligibilité)** : remplacer la whitelist de familles par le **critère de signification** (§8) —
  au minimum corriger le nommage pour inclure `observation`, avec un garde de signification (état daté
  d'un sujet durable ; exclure le transitoire). Le plus petit correctif sûr : inclure `observation` +
  garde, sans ouvrir aveuglément.
- **B2 (composite)** : à l'extraction, **éclater un fait multi-objets** en propositions mono-objet
  (option (a), seule propre dans l'archi actuelle). Alternative lourde = raccord occurrence↔sujets
  multiples (nouvelle table) — à cadrer séparément.
- Défaut #3 (une occurrence/rapport) : **hors P3**, à décider plus tard (impacte le modèle d'occurrence).

**A — repair Bella Napoli (après B validé) :**
- Registre 2024 + Largeur réduite 2025 → créer leurs occurrences (deviennent visibles).
- Composite cuisson/éclairage : éclater le fait 2025 → rattacher « cuisson à refaire » à « Contrôle
  cuisson » (→ traverse) et « éclairage à refaire » à « Contrôle éclairage » (→ cycle réalisé→à refaire),
  « électrique à refaire » reste sur « Contrôle électrique ». Avec snapshot/rollback.

**Aucune règle ni exception Bella Napoli dans le moteur.** B1 et B2 sont deux défauts distincts à
traiter séparément (ne pas mélanger éligibilité et composite).

**HARD STOP.** Diagnostic seul. Aucune modification avant validation. Ne pas démarrer B/A.
