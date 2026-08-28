# V2 — Spec : conservation de la preuve relationnelle dans les occurrences (SPEC + dry-run)

**Statut : SPÉCIFIÉ + DRY-RUN. READ-ONLY, aucun code d'écriture, aucun branchement, aucune relation créée, aucun backfill. HARD STOP.**

**Message principal (honnête) : l'architecture V2 est saine et peu coûteuse, MAIS le dry-run montre que le corpus
visite actuel ne contient quasiment AUCUNE dépendance sujet↔sujet — les causalités visite sont exprimées
sujet→action / sujet→événement / acteur→sujet. Coder V2 maintenant = re-construire une excellente tuyauterie
sans matière à faire circuler. Recommandation : figer le design (Option C), NE PAS coder, re-mesurer après
davantage de vraies visites.**

---

## 1. Champs existants de `canonical_subject_occurrence` (tracé)
`id, canonical_subject_id, site_id, source_kind, source_ref_id, source_proposal_id, visit_status, label, note,
evidence_count, effective_date, created_at, created_by, validation_status, entity_ids, updated_at, state_key,
event_date, state_status, source_page, thematic_category`.
→ **Aucun champ ne convient** : `note` = corps de la proposition (état atomique du sujet) ; l'enrichir mélangerait
état et contexte multi-sujets (rejeté). `site_knowledge_proposals` n'a **pas** de colonne `source_excerpt` (le
verbatim source vit dans `payload`/`body`). **Aucun foyer existant ne peut légitimement porter une preuve
relationnelle inter-sujets.**

## 2. Définition d'une preuve relationnelle (contrat)
Extrait source (verbatim, **sans reformulation LLM**), borné (~200 car.), lié au `source_ref_id` (report/run),
exprimant une relation explicite/quasi-explicite entre **≥2 canonical_subjects durables**. Exclus : deux phrases
voisines, même lieu/acteur/date/document, sujet→action, sujet→événement.

## 3. Point exact de perte (confirmé)
`debrief.summary/rationale → proposition.body → occurrence.note`. La perte est **propositions→occurrence (~69 %,
31 % conservés)** : l'occurrence porte `note = body` de LA proposition réconciliée ; la clause relationnelle vit
souvent (a) dans une proposition `decision`/`knowledge` distincte du sujet opérationnel, (b) dans le `summary`
non recopié, ou (c) mentionne un terme (« nettoyage carrelage », « démarrage du chantier ») qui n'est PAS un
canonical_subject. L'occurrence n'ayant pas de champ de preuve, la clause est inaccessible au juge.

## 4. Options de modèle
| | A — enrichir note/source_excerpt | B — champ dédié sur l'occurrence (`context_evidence_text`) | C — petite table de preuves relationnelles |
|---|---|---|---|
| Atomicité occurrence | ❌ mélange état + contexte | ✅ séparé | ✅ séparée |
| Preuve pour ≥2 sujets | ❌ dupliquée, incohérente | ⚠ dupliquée sur chaque occurrence | ✅ 1 preuve → N sujets |
| Provenance (source_ref) | partielle | oui | ✅ native |
| Idempotence | fragile | par occurrence | ✅ (source_ref + hash phrase) |
| Duplication | forte | moyenne | ✅ nulle |
| Réutilisation Copilote/V3 | faible | correcte | ✅ excellente |
| Coût schéma | 0 | 1 colonne nullable | 1 table additive |
| >2 sujets | non | mal | ✅ oui |

**Recommandation : Option C** — `subject_relational_evidence(id, site_id, source_ref_id, source_kind,
evidence_text, subject_ids uuid[], created_at)` (nom indicatif). Additif, non destructif. Idempotence :
UNIQUE(source_ref_id, hash(normalize(evidence_text))). Respecte B2 : l'occurrence reste atomique ; la preuve
inter-atomes vit à côté, portant plusieurs `canonical_subject_id`. C'est exactement « occurrence atomique +
phrase source plus riche conservée en parallèle ».

## 5. Preuve ≠ relation
V2 ne crée JAMAIS `A requires B`. Il garantit seulement que la phrase reste **cit-able** après matérialisation.
La relation n'existe qu'en V3, après passage par le juge déjà validé (whitelist, contexte partagé ≠ dépendance).

## 6. Dry-run de reconstruction (`scripts/audit-v2-reconstruction.ts`, sur le corpus visite réel)
Simule la capture de la phrase source (debrief.summary + rationale + proposition.body) et l'appariement aux
canonical_subjects du report :

| Mesure | Valeur |
|---|---|
| Phrases relationnelles (dédupliquées) | 41 |
| couvrant 0 sujet (contexte/narratif) | 21 |
| couvrant 1 sujet (**sujet→action/événement**, hors périmètre) | 18 |
| couvrant ≥2 sujets (**paire-preuve**) | **2** (et à la lecture, ce sont des faux appariements — énumérations, pas des dépendances) |
| Paires-preuves sujet↔sujet **réelles** | **≈ 0** |
| Taille moyenne | 91 car. |

**Conservation de la PHRASE : ~100 % atteignable** (on lit la source). **Rendement UTILE (paire-preuve
sujet↔sujet) : ≈ 0 sur le corpus actuel.** Les causalités visite réelles observées sont sujet→action
(« nécessite une vérification par l'électricien », « cadenas à présenter avant le démarrage »), acteur→sujet
(« AGP interviendra après la dépose »), ou visent un terme non-sujet (« en remplacement du nettoyage carrelage »).

## 7. Voix / transcription (V1, non ouvert)
`transcript_raw/corrected/text_input` sont **vides** sur tout le corpus visite actuel. À vérifier séparément sur
une vraie visite vocale future. Non traité ici.

---

## Sorties demandées — synthèse
- **Point de perte** : propositions→occurrence (occurrence sans champ de preuve ; clause dans proposition distincte / summary / terme non-sujet).
- **Foyer recommandé** : Option C, table `subject_relational_evidence` additive.
- **Respect B2** : occurrence atomique inchangée ; preuve inter-atomes stockée en parallèle.
- **Impact schéma** : 1 table additive (aucune destruction, aucun backfill dans ce lot).
- **Idempotence** : UNIQUE(source_ref_id, hash phrase normalisée).
- **Dry-run** : 41 phrases relationnelles → **≈0 paire-preuve sujet↔sujet réelle** aujourd'hui.
- **Conservation attendue** : phrase ~100 % ; rendement utile ≈0 (corpus).
- **Coût/taille** : négligeable (~91 car., quelques phrases/visite).
- **Ce que V3 consommerait** : lignes `subject_relational_evidence` (evidence_text + ≥2 subject_ids) → candidat cooc=1 → juge existant.

## Recommandation & décision
**FIGER le design (Option C), NE PAS coder V2 maintenant.** Raison : conserver la preuve est correct, mais le
corpus visite n'exprime pas encore de dépendances **sujet↔sujet** — les brancher produirait 0. Le blocage réel
est **en amont** (nature de ce que David exprime en visite) et **hors périmètre** (une dépendance sujet→action /
sujet→événement est un autre modèle que `canonical_subject_links` sujet↔sujet). Trois voies possibles pour toi :
1. **Design gelé + attente** : garder cette spec, re-lancer `audit-v2-reconstruction` après quelques vraies visites terrain ; coder V2 dès que le rendement paire-preuve devient non nul.
2. **Élargir le modèle** (hors périmètre actuel) : capturer aussi sujet→action/événement — décision produit majeure, pas une extension V2.
3. **Laisser PV/CR nourrir** `canonical_subject_links` (déjà actif) ; la visite reste un canal futur.

**HARD STOP après spec + dry-run. Aucun code d'écriture.** Moteur PV/CR actif et prompt validé non touchés.
