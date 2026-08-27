# P3-C — AUDIT READ-ONLY : multiplicité des états d'un même sujet dans un document

Date : 2026-08-28. READ-ONLY. Aucun code, aucune migration, aucun backfill, aucune réparation Bella.
Témoin officiel : éclairage Bella 2025 (réalisé 22/03/2024 + à refaire 05/08/2025, même sujet, un seul
slot). Question : **exception Bella, ou mauvaise granularité fondamentale de `canonical_subject_occurrence` ?**

## Réponse courte

**Mauvaise granularité fondamentale.** L'occurrence est **créée** comme « le sujet apparaît dans ce
document » (A) mais **consommée** comme « état daté du sujet » (B). Le modèle **1 occurrence par
(sujet, rapport)** (index `cso_historical_pdf_uniq`, mig 317) ne peut donc pas porter deux états datés
légitimes d'un sujet dans un même document. Ce n'est pas marginal (16,4 % de multiplicité, 12 cas
multi-état mixtes sur 2 corpus) et cela s'aggravera (B2 atomise les composites, P3-B1 rend les
observations éligibles — deux forces qui **augmentent** le nombre de propositions par (sujet, rapport)).

## 1. Sémantique AS-IS de `canonical_subject_occurrence`

- **Création** (`ensureHistoricalPdfOccurrences`) : groupe les propositions par (canonical_subject, rapport),
  produit **UNE** occurrence, `label`/`note` choisis par `selectBestText` parmi les propositions du groupe,
  `evidence_count` = nombre de propositions, `effective_date` = **date du document**. → sémantique **A**
  (« présence documentaire »), avec un état représentatif **agrégé**.
- **Consommation** (`canonical-subject-life.ts`) : occurrences **triées par `effective_date`** = la **ligne
  de vie** ; `lastSeenAt` = dernière occurrence ; `lastMeaningfulChangeAt` (`computeLmcaFromOccurrences`) ;
  `stagnationDays` = lastSeen − LMCA ; Évolution / Chronologie / Histoire lisent cette séquence. →
  consommée comme **B** (« suite d'états datés »).
- **Verdict : C (mélange), et c'est le défaut.** Créée en A, lue en B. Quand un document porte 2 états d'un
  sujet, A n'en garde qu'un ; B croit lire la trajectoire complète.

## 2. Multiplicité réelle (corpus disponible, 519 couples (rapport, sujet))

- **85 / 519 (16,4 %)** couples ont **≥ 2 propositions** métier sur le même sujet/document.
- **73** = **mêmes familles** → surtout reformulations/répétitions/preuves multiples → **doivent rester 1
  occurrence** (la déduplication actuelle est correcte ici).
- **12** = **familles MIXTES** → **multi-état légitime**. Exemples réels :
  - `knowledge_fact` « Extincteurs contrôlés par MIES en 04/23 » + `observation` « Contrôle des
    extincteurs à faire — URGENT » ;
  - `knowledge_fact` « Nettoyage conduits … réalisé » + `observation` « … à faire — URGENT » ;
  - `knowledge_fact` « Dégagement … précédemment [encombré] » + `decision` « Validation issue mall
    suffisante ».
- **Structurel, pas marginal**, et sous-estimé : le témoin éclairage **n'apparaît même pas** dans ce
  compte (les deux états y sont l'un dans un `knowledge_fact`, l'autre **piégé dans le composite** avant
  B2). Post-B2, l'atomisation créera la proposition « éclairage à refaire » → éclairage aura 2
  propositions 2025 → collision. **B2 et P3-B1 augmentent mécaniquement la pression multi-état.**

## 3. Trace de la perte

`source → proposition(s) → thread → canonical_subject → occurrence → (state signal) → restitution`

- **Point de perte = l'agrégation `(CS, rapport)`** dans `ensureHistoricalPdfOccurrences` : N propositions
  → 1 occurrence. `selectBestText` **choisit un label représentant** ; les autres états ne survivent que
  dans `evidence_count` (un simple compteur) et dans le texte des **propositions** (jamais relu par la
  ligne de vie). Idempotence via `ON CONFLICT DO NOTHING` : le 2ᵉ état est **skippé**.
- **Date événementielle remplacée par la date du document** : voir §4.
- L'information **reste disponible** (propositions, `source_excerpt`) mais devient **invisible à la mémoire
  longitudinale** (la ligne de vie ne lit que les occurrences).

## 4. Temporalité — `effective_date` ne sait exprimer que la date du document

Preuve corpus : **20/20 rapports** ont **toutes** leurs occurrences `historical_pdf` à la **même
`effective_date`** (= date du PV). Des occurrences dont le **label** porte une date événementielle
interne le confirment : « Installations électriques contrôlées … **le 22/03/2024** » a
`effective_date = 2024-07-19` ; « Extincteurs contrôlés … **en 04/23** » a la date du rapport. **La date
propre de l'événement n'est nulle part structurée** — elle vit uniquement dans le texte. Bella : PV =
05/08/2025, contrôle réalisé = 22/03/2024 → l'écart n'est **pas représenté**.

## 5. `object_state_occurrence_signal` (mig 349) résout-il déjà le problème ? — NON

Vérification demandée avant d'imaginer une couche. La table :
- **adresse `site_action` / `site_reserve` / `site_deadline`** (`entity_type,entity_id`) = **l'axe
  `canonical_business_object`**, PAS `canonical_subject_occurrence`, PAS le sujet ;
- vocabulaire **cycle de tâche** (`OPENED/PROGRESS/COMPLETED/REOPENED/NO_STATE_SIGNAL`), pas un
  événement daté quelconque (« réalisé le 22/03/2024 ») ;
- ne couvre **pas** `knowledge_fact` / `observation` (le « réalisé » de l'éclairage n'a aucun signal) ;
- `UNIQUE (entity_type, entity_id)` = **une ligne par occurrence d'objet métier**, pas par état de sujet.

**Conclusion** : ce n'est pas la couche « occurrence + états enfants » d'un sujet. En revanche elle
**prouve que la doctrine existe déjà** dans MemorIA : *« la trajectoire est une fonction pure recalculée
à partir de signaux atomiques par occurrence, jamais un champ statut mutable »*. C'est exactement le
patron que la cible (B) appliquerait à `canonical_subject_occurrence`. **Ne pas la surcharger** (mauvais
axe, mauvaise portée).

## 6. Comparaison A / B / C

| Dimension | **A — sujet×rapport agrégé (actuel)** | **B — occurrence = état/événement daté atomique** | **C — occurrence documentaire + événements enfants** |
|---|---|---|---|
| Clé d'unicité | `(subject, report)` | `(subject, report, event_key)` déterministe | occurrence `(subject, report)` + table enfant `(occurrence, event_key)` |
| Idempotence | forte (mais perd les états) | forte **si** `event_key` déterministe | forte, double niveau |
| Multi-état/doc | **impossible** (perte) | **natif** | natif (dans l'enfant) |
| Provenance/preuve | agrégée (evidence_count) | 1 occurrence ↔ 1 proposition | occurrence doc + enfants ↔ propositions |
| Date événement | non (date doc) | **possible** (champ dédié) | possible (sur l'enfant) |
| LMCA/lastSeen/Évolution | sur occurrences pauvres | recalcul sur N états (plus riche) | recalcul sur les enfants |
| Lignes de vie/Chrono/Histoire | 1 point/doc | **N états/doc** | N états/doc |
| `object_state_occurrence_signal` | axe séparé (CBO) | **même doctrine, étendue au sujet** | risque de doublonner la couche signal |
| Complexité | nulle | **moyenne** (clé + dérivation + LMCA + UI) | élevée (2 niveaux, + UI, + jointures) |
| Compat. existant | totale | additive (clé élargie) | additive mais 2 tables |
| Risque | **perte prouvée** | sur-split si mal gardé | sur-ingénierie / couche redondante |

## 7. Le risque à ne PAS confondre (deux dimensions distinctes)

- **B2** (déjà livré) : *« 1 proposition = 1 sujet durable »* (atomicité horizontale : ne pas mêler
  plusieurs sujets dans une proposition).
- **P3-C** : *« un même sujet durable peut avoir plusieurs états/événements datés dans le même
  document »* (multiplicité verticale).

Ce sont **deux axes orthogonaux**. La cible B ne doit PAS casser la **déduplication** des reformulations,
répétitions et preuves multiples (les 73 cas « même famille » restent **1 occurrence**). Seuls des états
**réellement distincts** (familles/verdicts/dates différents) deviennent N.

## 8. Idempotence cible

Le cœur de B = **une identité d'événement stable**, pour rejouer 10× le même PV sans créer 10 événements.
Candidats déterministes pour `event_key` (dérivé de la source, jamais aléatoire) :
- `source_proposal_id` quand il existe (canal historique : 1 proposition = 1 état) — le plus simple et le
  plus fidèle ; **la clé devient `(subject, report, source_proposal_id)`** ;
- à défaut (occurrences terrain sans proposition) : signature de contenu déterministe
  (`hash(normalized_label, family, effective_date_bucket)`).
Ainsi : re-matérialiser le même PV → mêmes `source_proposal_id` → **aucun doublon**. On **n'enlève pas**
la contrainte UNIQUE, on l'**affine** — on ne la remplace jamais par « pas de contrainte ».

## 9. Conclusion

- **Fréquence observée** : 16,4 % multi-proposition ; **12 cas multi-état mixtes** sur 2 corpus ; en
  croissance (B2 + P3-B1). Pattern Géant (VGP « contrôlé le X — défaut au Y », SSI « vérifié — prochaine
  échéance ») → **structurel**.
- **Perte actuelle** : pour chaque multi-état, **1 état matérialisé, les autres réduits à un compteur** ;
  **date événementielle interne non structurée**.
- **Sémantique AS-IS** : créée A, lue B → incohérente.
- **Sémantique TARGET recommandée** : **B — occurrence = état/événement daté atomique d'un sujet.**
- **Choix A/B/C** : **B.** (A = perte prouvée ; C = couche redondante, `object_state_occurrence_signal`
  est un autre axe qu'il ne faut pas surcharger.)
- **Plus petit changement architectural** : **affiner la clé d'unicité** `cso_historical_pdf_uniq` →
  `(canonical_subject_id, source_ref_id, source_proposal_id)` (canal historique) + un `event_key`
  déterministe pour le canal terrain ; **retirer l'agrégation** dans `ensureHistoricalPdfOccurrences`
  (1 occurrence par proposition retenue au lieu d'1 par groupe) ; optionnel : champ `event_date` distinct
  de `effective_date` pour la date interne (§4). Reste **additif**.
- **Risques** : sur-split si la déduplication même-famille n'est pas préservée ; recalcul LMCA/Évolution
  sur N états ; adaptation UI (afficher N états/doc) ; **backfill** des occurrences existantes.
- **Migration/backfill** : re-dériver les occurrences depuis les propositions avec la nouvelle clé ; les
  12 groupes mixtes → N occurrences ; l'éclairage Bella → obtient enfin son « à refaire ».
- **Corpus de non-régression** : les 12 cas mixtes (doivent se dédoubler), les 73 même-famille (doivent
  rester 1), le témoin éclairage, les cas à date interne (22/03/2024, 04/23).

### GO / NO-GO

**Recommandation : GO sur la DIRECTION (cible B), en LOT DÉDIÉ — jamais glissé dans un autre lot ni dans
Bella.** Ce n'est pas une exception Bella : c'est la dernière brique de représentation avant que la
restitution puisse être correcte. Deux sous-décisions pour toi :
1. **Quand** : implémenter B **avant** l'audit écran (recommandé — sinon la ligne de vie n'a qu'un
   événement là où le document en porte deux, et aucune UI ne corrigera cela), ou faire l'audit écran en
   **signalant explicitement** la limite connue puis revenir à B.
2. **Portée du 1er lot** : clé + dé-agrégation (mémoire longitudinale correcte) d'abord ; `event_date`
   interne (§4) en second temps.

**HARD STOP.** Audit livré. Aucun code, aucune migration, aucune donnée modifiée.
