# P3-B2-workflow — Invariant d'atomicité « 1 proposition = 1 sujet durable » (Option A)

Date : 2026-08-27. Suite de [P3-B2-AUDIT](./P3B2-AUDIT-ATOMICITE-PROPOSITIONS.md). Option A confirmée
(atomiser à l'extraction), avant B2-repair. Aucune donnée modifiée.

## Ce qui change

Le contrat d'extraction (`buildExtractionPrompt`, `lib/documents/historical-visit-extractor.ts`) énonce
désormais explicitement l'**invariant** — jusqu'ici absent :

- **1 proposition = 1 sujet métier durable** (PAS « 1 équipement », « 1 nom », « 1 élément de liste »).
- **Éclatement** : une phrase portant un MÊME état sur PLUSIEURS sujets à évolution INDÉPENDANTE → N
  propositions, partageant **la même page, le même extrait, les mêmes preuves (evidenceKeys)**, même date,
  même priorité, et même acteur SI le texte l'attribue à chacun. **Jamais inventer une preuve.**
- **Garde anti-sur-split** (double contre-test, les deux doivent être OUI) :
  1. états futurs réellement indépendants ? 2. sujets **ré-identifiables individuellement** dans un prochain
  CR ? Sinon, ou en cas de **doute → une seule proposition** (pas de micro-sujets artificiels).
- **Aucun split lexical** sur « et / + / , / listes ». Cas de **non-split obligatoires** : conduits
  air vicié/buée/graisse ; tableau+câblage ; portes CF d'un niveau ; SSI (CMSI/détecteurs/diffuseurs) ;
  coordination LOT01/LOT02.
- **Hésitation → conserver le composite** (sous-split récupérable ; sur-split irréversible).

**Aucun second LLM** : l'atomisation fait partie du contrat de l'extracteur existant.

**Provenance (vérifié)** : le schéma `LlmProposal` porte `evidenceKeys: string[]`, `sourceExcerpt`,
`sourcePage` **par proposition**, et `evidence[]` est défini une seule fois → **1 preuve → N propositions
est déjà supporté** (N propositions référencent la même clé de preuve), sans duplication ni perte de
page/extrait. Idem `linkedActorTemporaryKey` par proposition. **Aucun changement de schéma.**

## Vérifications

| Vérification | Résultat |
|---|---|
| Tests de contenu du contrat (10) | **PASS** — invariant, MUST_SPLIT, garde anti-sur-split, non-split obligatoires, doute→1 |
| Typecheck / Lint | **PASS** — 0 / 0 |
| Recette dry-run Bella 2025 (juge réel) | voir ci-dessous |

### Recette dry-run — CR Bella 2025 entier (aucune écriture)

Texte source reconstitué à partir des `source_excerpt` réels du run 2025, repassé dans l'extracteur avec
le nouveau contrat. Gardes spécifiques **tous verts** :

| Garde | Résultat |
|---|---|
| **MUST_SPLIT** composite → 3 atomiques | ✅ « Contrôle électrique à refaire » / « Contrôle de l'éclairage à refaire » / « Contrôle des appareils de cuisson à refaire » (3 propositions distinctes) |
| **NON-split** conduits (air vicié/buée/graisse jamais isolés) | ✅ 0 composant isolé (« d'air viciée, de buée et de graisse » reste intact) |
| **NON-split** climatisation (groupe froid/chambre froide groupés) | ✅ « Contrôles de la climatisation (Groupe froid, chambre froide et clim') » = 1 |
| Autres phrases (formation extincteurs+évacuation, huiles usagées…) | ✅ 1 proposition chacune, aucun sur-split lexical |

Compte global **informatif** (non critère : LLM non déterministe, extraction légitimement plus riche) :
18 → 22-23 propositions métier. Le delta = +2 (split composite correct) + faits knowledge_fact/deadline
supplémentaires (nettoyage réalisé + prochaine échéance) — **pas** des sur-splits lexicaux.

**Résidu à surveiller (non bloquant)** : « Signature registre sécurité (clim, hotte) » a parfois été
éclaté en 2 (entretien clim / nettoyage hotte). Défendable (2 opérations de maintenance à suivi propre)
mais borderline vs la règle « doute → 1 ». À observer sur Géant/futurs imports ; pas de correction
maintenant (ne pas durcir le prompt au risque de casser le MUST_SPLIT).

## Portée & suite

- **B2-workflow livré** : contrat + tests + recette. Le changement s'applique aux **futurs imports**
  (dont CR 2026). Il **ne modifie pas** rétroactivement le composite déjà en base sur Bella.
- **B2-repair Bella** (séparé, non fait) : éclater le fait 2025 existant en électrique/éclairage/cuisson.
  ⚠️ **Prudence forte** : le fait électrique 2025 existe DÉJÀ dans la bonne ligne de vie (P2-A). Le repair
  devra partir de **l'état actuel du graphe** (ne pas recréer 3 faits naïvement → électricité en double) :
  conserver l'occurrence électrique existante, ajouter seulement éclairage + cuisson sur leurs sujets,
  avec snapshot/rollback. À cadrer à son démarrage.

**HARD STOP.** B2-workflow prouvé (contrat + tests + recette complète du CR 2025). B2-repair attend ton GO,
avec le cadrage « partir du graphe actuel, pas rejouer le PDF ».
