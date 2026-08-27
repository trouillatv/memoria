# P1-C2a — Audit faux négatifs + architecture rapprochement sémantique inter-années

Date : 2026-08-27. READ-ONLY. Aucun rematching. Bug B (rapprochement sémantique) uniquement.
Base : état APRÈS P1-C1 (Bug acteur éliminé, liens acteur posés, spanning_both=3). Site Bella Napoli.

## 1. Audit des faux négatifs restants (livrable #1)

20 business_subject avec occurrences : **spanning=3** (extincteurs, friteuse, nettoyage),
only2024=4, only2025=13. Paires plausibles (only2024 × only2025) classées :

| Paire | jac | Verdict | Action P1-C2 |
|---|---|---|---|
| **Dégagement extérieur du Mall (2024) ↔ Issue de Secours du food court (2025)** | 0.00 | **SAME_SUBJECT** (à confirmer) | **le seul vrai cas** |
| Contrôle des installations électriques (2024) ↔ Registre de sécurité installations électriques (2025) | 0.29 | **RELATED_BUT_DISTINCT** | ne PAS fusionner |
| Contrôle appareils cuisson (2024) ↔ (aucun sujet cuisson 2025) | — | UNRELATED | rien |
| Séparation des flux (2024) ↔ Formation / Largeur (2025) | 0.14 | UNRELATED | rien |
| tous les autres only2025 | 0 | UNRELATED | rien |

**Surface réelle = 1 vrai faux négatif** (Mall/food court) + **1 piège de sur-fusion** (électrique
vs registre). Gain théorique maximal sur Bella Napoli : **spanning_both 3 → 4**. C'est tout.

Note : la vraie continuité électrique (2024 «Contrôle installations électriques» ↔ 2025 «Contrôles
électriques à refaire ») est **bloquée par un autre défaut** — le fait 2025 « à refaire » est
canonicalisé sur le CS «Registre…» (conflation registre/contrôle, défaut 2 de P1-B). C'est une
réparation de conflation, **pas** un rapprochement sémantique. À traiter séparément, jamais en
fusionnant «Contrôle électrique» avec «Registre».

## 2. Le juge existe déjà et est robuste (ne rien réécrire) — livrable #4

`lib/subjects/similarity-analyze.ts::analyzeSubjectPair` (Gemini) offre exactement le contrat voulu :
- verdict fermé **`same_subject | related | distinct | uncertain`** + `score` + `recommendation`
  (`merge|link|none`) + `reason` court ;
- garde-fous : `fusionBlockReason` (interdit merge), `fusionWarningReason` (prudence), contre-exemples
  intégrés (événement daté ≠ document résultant ; générique récurrent ≠ épisode daté ; reformulation
  du même travail = same_subject) ;
- déjà appelé en **Phase 1.6** de `reconcileHistoricalPvCanonicalSubjects` (`same_subject` → attach).

⇒ **Réutiliser `analyzeSubjectPair`**, ne pas créer un second moteur de décision (cohérent avec ta
consigne). Le juge favorise déjà le faux négatif (`uncertain` → aucune action).

## 3. Le vrai trou = le PRÉFILTRE (ce qui atteint le juge)

Phase 1.6 ne soumet au juge que des candidats au-dessus d'un **seuil de Jaccard normalisé**
(`P01_NORMALIZED_JACCARD_THRESHOLD`). Mall↔food court = jac 0.00 → **n'atteint jamais le juge** →
faux négatif. Baisser ce seuil est exactement ce que tu interdis (sur-fusion large). Il faut donc un
**générateur de candidats non-lexical, borné, en dernier recours**, qui n'abaisse PAS le seuil
d'auto-match.

### Signaux disponibles pour préfiltrer (livrable #3) — état réel

| Signal | Disponible ? | Capte Mall↔food court ? |
|---|---|---|
| Jaccard lexical | oui | **non** (0 token commun) |
| Acteur/entité partagé | oui (occurrence_actor_link) | **non** (aucun acteur commun) |
| Topic partagé (`canonical_topic_subject`) | table existe mais **0 topic assigné** | non (pas de signal) |
| Embedding de sujet | **inexistant** (embeddings seulement sur knowledge_chunks/trace) | oui SI on les crée |
| Contexte d'occurrence (notes) | oui | oui, mais lexicalement 0 en commun |

⇒ Le seul cas réel n'a **aucun signal lexical/acteur/topic**. Seuls des **embeddings de sujets**
(nouvelle infra) ou un **juge LLM sur pool élargi** peuvent le surfacer.

## 4. Comparaison d'options (livrable #2/#9) — tu tranches

Toutes réutilisent `analyzeSubjectPair` comme juge (enrichi du contexte d'occurrence, cf. §5).

**Option A — LLM sur pool élargi borné (recommandée maintenant).**
Après échec des phases 1/1.5/1.6, pour un sujet métier non rattaché : soumettre au juge chaque
business_subject non-traversant du même site (pool petit : ~13 ici), **cap dur** (ex. ≤ 20 candidats,
sinon skip + log — pas de troncature silencieuse). `same_subject` unique → rattacher ; sinon nouveau
sujet.
- Coût : ~N appels LLM `light` (maxOutputTokens 300) par sujet non rattaché à l'import. Bella Napoli : ~4.
- Infra : **aucune nouvelle**. Risque sur-fusion : borné par le juge strict + cap.
- Limite : sur Géant (centaines de sujets), le cap protège mais peut manquer des cas au-delà du cap
  (accepté : faux négatif > faux positif).

**Option B — Embeddings de sujets + cosine top-K + juge.**
Embed label+contexte de chaque sujet à l'import (fournisseur déjà utilisé pour knowledge_chunks),
cosine top-K parmi les non-traversants, puis juge.
- Coût : 1 embedding par sujet + cosine (négligeable) + K appels juge.
- Infra : **nouvelle** (colonne/table d'embedding de sujet + backfill + maintenance). Scalable sur Géant.
- Risque : embeddings peuvent rapprocher des voisins de domaine (électrique vs registre) → **le juge
  strict reste le garde-fou**. Sur-ingénierie pour 1 cas aujourd'hui.

**Option C — ne rien faire maintenant, rouvrir sur preuve Géant.**
La surface est 1 cas. On peut décider que 3/4 spanning est suffisant avant 2026 et traiter le
sémantique quand un corpus multi-format (Géant) le justifie réellement.

**Ma recommandation** : **Option A** (réutilise le juge, aucune infra, cap dur, favorise le faux
négatif). Elle résout le cas Mall/food court sans risque d'infra ni de sur-fusion générale. Passer à
B seulement quand Géant prouve le besoin d'échelle. Je ne construis pas d'embeddings de sujets pour 1
cas sans ton accord (choix structurel).

## 5. Contrat du juge (enrichissement nécessaire) — livrable #4

`analyzeSubjectPair` reçoit aujourd'hui label + aliases + dates + statut + objets actifs, **pas** le
texte des occurrences. Or tu veux qu'il utilise le contexte (localisation, fonction d'évacuation,
Mall/food court). Ajout minimal : passer en entrée un **extrait de contexte d'occurrence** (labels +
notes des occurrences du sujet, tronqué) comme signal supplémentaire. Verdict inchangé, garde-fous
inchangés. Mapping : `same_subject` → rattacher ; `related`/`distinct`/`uncertain` → **aucun match**
(favorise le faux négatif). Pour la paire électrique/registre, passer `fusionWarningReason` (types
différents : contrôle technique vs tenue documentaire) pour renforcer le refus.

## 6. Préfiltre (garde-fous durs) — livrable #3

Avant le juge, exclure **toujours** : `kind='actor'` ; sujets non-`active` ; le sujet lui-même ;
paires déjà spanning ; (Option B) voisins cosine sous un seuil. Le juge n'arbitre **qu'entre quelques
candidats plausibles**, jamais tout le graphe. Aucune baisse du seuil Jaccard d'auto-match.

## 7. Corpus de tests obligatoire (livrable #5/#8)

**Doit matcher (si l'audit humain confirme)** : Dégagement extérieur du Mall ↔ Issue de Secours du
food court.
**Ne doit PAS matcher** : registre électrique ↔ contrôle électrique ; nettoyage conduits ↔ signature
registre hotte ; friteuse ↔ appareils de cuisson ; extincteurs ↔ têtes de sprinkler ; issue Mall ↔
séparation des flux ; acteur ↔ sujet métier.
**Synthétiques génériques** : synonymes forts (doit) ; reformulation complète (doit) ; même domaine
objets différents (ne doit pas) ; labels quasi identiques mais lieux/équipements différents (ne doit
pas) ; générique vs spécifique (related, pas merge) ; ambiguïté réelle (uncertain → pas de match) ;
deux candidats plausibles (uncertain/pas de match auto) ; aucun candidat (not_found).

## 8. Mesures attendues (livrable #9) — projection

- Faux négatifs restants : **1** (Mall/food court).
- Récupérables par P1-C2 : **1** (si juge confirme same_subject).
- Faux positifs ajoutés visés : **0** (le piège électrique/registre doit rester distinct).
- spanning_both : 3 → **4** (théorique, si confirmé).
- Critère principal : **0 nouvelle sur-fusion connue**.

## 9. Coût / latence (livrable #9)

Option A : ~4 appels `light` (≤300 tokens sortie) à l'import Bella Napoli ; négligeable. Géant : borné
par le cap. Option B : + coût d'embedding par sujet (une fois) + stockage vectoriel.

## 10. Limites connues (livrable #10)

- Le juge décide sur label + contexte tronqué ; un contexte trop pauvre → `uncertain` (faux négatif
  assumé).
- Option A ne scale pas au-delà du cap (protège au prix de faux négatifs au-delà).
- La continuité électrique reste bloquée par la **conflation registre/contrôle** (hors P1-C2).
- `related` n'est PAS matérialisé en `canonical_subject_links` dans ce lot (livrable #11 : cette
  sortie sert seulement à empêcher une mauvaise fusion).

## HARD STOP — décision requise avant de coder

L'audit montre une surface d'**un seul cas** et **aucune infra d'embedding de sujet**. Avant d'écrire
le resolver + dry-run, je te demande de trancher le **moteur** :

1. **Option A** (recommandée) — juge LLM sur pool borné, réutilise `analyzeSubjectPair`, aucune infra,
   cap dur, enrichi du contexte d'occurrence ? → je livre resolver + tests + dry-run Bella Napoli.
2. **Option B** — embeddings de sujets (nouvelle infra) + cosine + juge ?
3. **Option C** — différer P1-C2 (3/4 spanning suffisant avant 2026, rouvrir sur preuve Géant) ?

Aucun rematching réel avant ta validation.
