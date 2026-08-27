# P3-B2-AUDIT — Atomicité métier des propositions (READ-ONLY)

Date : 2026-08-27. READ-ONLY. Aucun code, aucune réparation Bella. Cas témoin : « Contrôles
électriques, éclairage et cuisson à refaire ». **Objectif : une règle transverse d'atomicité
(CR/PV/VGP/SSI), pas réparer cette phrase.**

## Question centrale (Vincent)

> « une proposition = un sujet durable » est-il déjà un invariant de MemorIA, ou faut-il en faire un ?

**Réponse : ce n'est PAS un invariant aujourd'hui.** Ni le contrat d'extraction ne l'impose (§2), ni
l'aval ne l'enforce (le modèle `canonical_subject_occurrence.canonical_subject_id` est mono-sujet, donc
il *suppose* un sujet unique mais n'a aucun moyen de le garantir). Il faut en faire un invariant
**explicite** — c'est le cœur de B2, et le levier qui simplifie tout l'aval.

## 1. Trace de la chaîne — où naît le composite

`texte PDF → extraction LLM → proposition → thread → canonical_subject → occurrence`

| Étage | Contenu |
|---|---|
| **Texte PDF (source)** | `« Contrôle électrique + éclairage + appareils de cuisson : en retard. A refaire immédiatement ! »` |
| Extraction LLM | **1 proposition** `action` : label « Contrôles électriques, éclairage et cuisson à refaire » |
| Thread + canonical | 1 thread → 1 canonical_subject (« Contrôle électrique » après P2-A) |
| Occurrence | 1 occurrence rattachée à ce seul sujet ; éclairage & cuisson restent dans le texte |

**Le composite naît au PREMIER étage : le texte source lui-même groupe les trois** (opérateur « + »).
L'extracteur n'a rien agrégé — il a fidèlement conservé une phrase source = une proposition. **Ce n'est
donc pas un bug d'extraction ; c'est l'absence d'une règle d'atomisation.**

## 2. Contrat d'extraction — autorise-t-il le composite ?

Lecture de `buildExtractionPrompt` (`lib/documents/historical-visit-extractor.ts`). Le contrat cadre
QUOI extraire (spécifique au chantier, évolutif, familles) mais **ne contient AUCUNE règle d'atomicité**
« une proposition = un objet métier ». La seule règle voisine est la **consolidation de tableaux**
(§knowledge_fact) : elle interdit de *consolider* des lignes d'**objets métier distincts** — mais elle
est bornée aux lignes de tableau, et **il n'existe pas de règle inverse** demandant d'*atomiser* une
phrase libre portant un même état sur N sujets distincts.

**Verdict : le comportement actuel NE VIOLE PAS le contrat ; le contrat autorise implicitement les
composites.** ⇒ B2 = **lacune de contrat**, pas un bug. Le correctif principal est une **règle
d'atomicité ajoutée au contrat**, cohérente avec la règle de non-consolidation déjà présente.

## 3. Fréquence des composites dans le corpus (1000 propositions métier)

Heuristique brute « A, B et C » → **85/1000 (8,5 %)**. Mais **~90 % sont de FAUX composites**. Classement
de l'échantillon représentatif :

| Classe | Exemples réels | Éclater ? |
|---|---|---|
| **TRUE_COMPOSITE** | « Contrôles électriques, éclairage et cuisson à refaire » (le témoin) | **oui** |
| **ONE_SUBJECT_WITH_COMPONENTS** | « Nettoyage des conduits d'air vicié, de buée et de graisse » ; « Armoire électrique suffisante pour bornes et éclairage » ; « Arrêt d'urgence en place, accessible et visible » ; « Busages sous plateforme et fonds de regard » | non |
| **RELATION** (le lien EST le sujet) | « Coordination entre LOT01 et LOT02 » ; « Transmission photos et rapport G3 » | non |
| **ENUMERATION** (liste informative) | « Intempéries … inondations et fermeture d'écoles » ; « Moyens humains et matériel » | non |

**Fréquence réelle des TRUE_COMPOSITE ≈ très faible** (le témoin domine ; ~1 % du corpus visible). C'est
capital : **un split lexical (« et »/« , » → N) sur-éclaterait massivement** (Coordination LOT01/LOT02,
conduits air/buée/graisse, armoire bornes/éclairage). C'est le sur-splitting symétrique de nos anciennes
sur-fusions — à éviter absolument.

## 4. Règle d'atomicité métier proposée

**Pas** « plusieurs noms = plusieurs propositions ». La règle est **sémantique** :

> Une proposition doit pouvoir être rattachée **sans perte** à **une seule identité métier durable**.
> Une affirmation est **composite** si elle porte **le même état** sur **N sujets qui peuvent évoluer
> INDÉPENDAMMENT**.

Test de décision (le même esprit que R2e, en miroir) :
- Après un futur PV, ces objets peuvent-ils prendre des **états différents** ? (électrique réalisé /
  éclairage encore à refaire / cuisson non applicable) → **composite → éclater**.
- Les termes sont-ils des **composants/attributs d'un seul objet** (conduits : air/buée/graisse), une
  **relation** (coordination A↔B), ou une **liste descriptive** (intempéries incluant X et Y) → **un seul
  sujet, ne pas éclater**.
- **En cas de doute → NE PAS éclater** (favoriser le sous-split : récupérable ; le sur-split fragmente
  la mémoire et duplique les histoires — irréversible sans re-fusion).

## 5. Option A (atomiser à l'extraction) vs Option B (proposition composite → N sujets)

| Dimension | **A — atomiser à l'extraction** | **B — composite → N sujets en aval** |
|---|---|---|
| Modèle de données | inchangé (occurrence mono-sujet reste vraie) | **nouvelle table** proposition↔N sujets + occurrence↔N sujets (n'existe pas) |
| Provenance / preuve | 3 propositions **partagent la même evidence** (déjà supporté par `evidenceKeys`) | 1 proposition, N cibles — provenance OK mais matérialisation à réinventer |
| Canonicalisation | chaque proposition suit le pipeline normal (thread→sujet) | résolveur doit gérer 1→N (nouveau) |
| Occurrence / ligne de vie | 1 occurrence par sujet → **chaque ligne de vie a son état propre** | occurrence multi-cible → tout le calcul de ligne de vie à adapter |
| Revue humaine | 3 faits visibles, **preuve commune à montrer** (§8) | 1 fait à « déplier » — UI à inventer |
| Complexité | **faible** (règle de prompt + garde) | **élevée** (schéma, resolver, occurrence, lignes de vie) |
| Compat. existant | totale | rupture du modèle mono-sujet |
| Risque de duplication | preuve partagée (pas de dup) si bien fait | faible mais modèle plus lourd |
| Risque principal | **sur-split** (mitigé par §4 : sémantique + doute→non) | dette structurelle durable |

**Recommandation : Option A.** Elle garde l'invariant « occurrence = 1 sujet », fait travailler
canonicalisation / occurrences / lignes de vie / rapprochements sur des **unités métier propres** — exactement
le gain que tu vises. B introduit une représentation multi-cible lourde pour un phénomène rare (§3). A
conclut B seulement si le corpus montrait des composites fréquents ET indécomposables — ce n'est pas le cas.

## 6. Preuve — ne pas la dupliquer

Si A : les 3 faits atomiques **référencent la même preuve source** (même `evidence` / `source_excerpt`).
Le schéma le permet déjà (`evidenceKeys` : plusieurs propositions → une même clé de preuve). **Distinguer
la preuve documentaire (une phrase) du fait métier extrait (N faits)** : une phrase peut être preuve
commune à plusieurs faits. Aucune duplication de source.

## 7. Acteurs — pas de retour à P1

« Contrôles électrique, éclairage et cuisson réalisés par Bureau Veritas » éclaté en 3 → chaque fait
porte `sourcePayload.linkedActorTemporaryKey` = Bureau Veritas, et le workflow acteur déjà livré
(`occurrence_actor_link`, `performed_by`, P1-C1b) pose le lien sur **chacune des 3 occurrences**.
L'acteur reste une **entité liée**, jamais le sujet. Aucun retour au bug acteur=sujet.

## 8. Revue humaine — visibilité de la preuve commune

Exigence forte : si l'IA produit 3 faits d'une phrase, la revue (`ExtractionReviewClient`) doit **montrer
qu'ils partagent la même preuve** (même extrait, même page) — regroupés ou marqués « issus du même
constat ». **Pas de correction invisible après validation** : le split doit être compréhensible AVANT
matérialisation. C'est une exigence UI du lot B2-workflow (pas juste un changement de prompt).

## 9. Cas difficiles (anti sur-split)

| Cas | Verdict proposé | Raison |
|---|---|---|
| Extincteurs **et** RIA contrôlés | **2 sujets** | équipements distincts, évoluent séparément |
| Installation électrique : tableau **et** câblage conformes | **1 sujet (composants)** par défaut | parties d'un même contrôle d'installation ; éclater seulement si le chantier suit tableau/câblage séparément |
| Portes CF du niveau 1 contrôlées | **1 sujet collectif** | pas d'identité par porte dans le corpus → surtout PAS N propositions/porte |
| SSI : CMSI, détecteurs **et** diffuseurs testés | **1 sujet SSI** par défaut | sous-systèmes non suivis individuellement ici ; éclater seulement si le corpus prouve un suivi propre |

Principe : **éclater seulement quand les sujets sont réellement suivis séparément**. Sinon → un sujet
(collectif ou à composants). Le doute penche vers l'unité.

## 10. Livrable — synthèse

- **Cause exacte** : le texte source groupe (« + ») ; le contrat d'extraction n'a pas de règle
  d'atomicité → l'extracteur produit légitimement 1 proposition composite. Défaut = lacune de contrat.
- **Fréquence** : TRUE_COMPOSITE rare (~1 % ; l'heuristique brute 8,5 % est à ~90 % de faux positifs).
- **Règle d'atomicité** : §4 (une identité durable ; même état sur N sujets évoluant indépendamment ;
  doute → ne pas éclater).
- **A vs B** : **A** (atomiser à l'extraction), B rejetée sauf preuve contraire du corpus.
- **Impact workflow futur** : règle ajoutée au contrat d'extraction + garde anti-sur-split ; aval inchangé.
- **Impact revue UI** : montrer la preuve commune des faits issus d'une même phrase (exigence B2-workflow).
- **Migration/backfill** : composites déjà importés (le témoin Bella + éventuels autres) → **B2-repair**
  séparé (éclater le fait 2025 en électrique/éclairage/cuisson, rattacher chacun à son sujet, snapshot).
  Pas de re-extraction globale nécessaire vu la rareté.
- **Tests nécessaires** : corpus de classification (TRUE_COMPOSITE / ONE_SUBJECT / RELATION / ENUMERATION)
  incluant témoin + les 4 cas difficiles ; asserter que coordination/composants/énumérations restent
  **1 sujet** et que seul un vrai multi-sujets-même-état éclate.
- **Risques** : **sur-split** (fragmentation, histoires dupliquées — irréversible) >> **sous-split**
  (récupérable). Doctrine : favoriser le sous-split, symétrique du « favoriser le faux négatif » de R2e.

## Recommandation finale

1. **Faire de « une proposition = un sujet métier durable » un invariant explicite**, énoncé dans le
   contrat d'extraction (règle d'atomicité §4) + garde anti-sur-split, et **testé**.
2. **Option A** : atomisation à l'extraction, preuve partagée, acteurs propagés, split visible en revue.
3. **Favoriser le sous-split** (doute → un seul sujet) pour ne pas recréer une sur-fragmentation.
4. B2 se décompose ensuite en : **B2-workflow** (contrat + garde + UI revue + tests) puis **B2-repair
   Bella** (éclater le composite 2025, réversible) — deux lots séparés.

**HARD STOP.** Audit livré. Aucun code, aucune donnée modifiée. Attend ton arbitrage (A confirmé ? ordre
B2-workflow puis B2-repair ?).
