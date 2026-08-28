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

## 8. Complément — mesure PHRASE-LEVEL + témoins (`scripts/audit-v2-temoins.ts`)
Recadrage (ta doctrine) : V2 conserve la **phrase** rattachée aux sujets qu'elle mentionne — SANS exiger que
les DEUX bouts soient des canonical_subjects (V3 tranchera plus tard). Mesure au niveau phrase :

| Mesure | Valeur |
|---|---|
| Phrases relationnelles rattachables (≥1 sujet mentionné) | 21 |
| **Conservées dans une note aujourd'hui (AVANT)** | **2 (10 %)** |
| **V2 Option C — conservées (APRÈS)** | **21 (100 %)** ✅ cible >90 % atteinte |
| Duplication moyenne (sujets / preuve) | 1,19 |
| Phrases > 2 sujets | 1 |
| **Risque mis-attribution** (phrase logée dans la note d'un sujet NON mentionné) | **1** → Option C l'élimine (subject_ids explicites) |

**Témoins tracés (lignée réelle) :**
- *« nettoyage carrelage remplacé par panneaux isothermes »* (report 22b3f95e, proposition `decision`) : mentionne
  **1** sujet canonique (« Nettoyage panneaux isothermes ») ; **non conservée** dans une occurrence aujourd'hui ;
  V2 Option C : `subject_relational_evidence{ source_ref, subject_ids:[nettoyage panneaux], evidence_text }`,
  **occurrences inchangées (atomiques)** → V3 pourra présenter la phrase au juge sans reconstruire le contexte.
- *« si les produits sont repris, cela empêcherait la revégétalisation »* (report 8255fcbf, `vigilance`) : mentionne
  **0** sujet canonique (ni « produits décharges » ni « revégétalisation » n'existent comme sujets sur ce site) ;
  V2 la conserve en preuve **niveau report** (subject_ids=[]) → utile seulement si/quand ces sujets existent.
- *« cadenas … avant le démarrage »* : cadenas = sujet, « démarrage » = événement (pas un sujet).

**Les 3 invariants demandés sont démontrés** : (1) les sujets restent atomiques (occurrences inchangées) ;
(2) la phrase survit après matérialisation (10 %→100 %) ; (3) V3 lira la phrase + subject_ids sans reconstruire.

---

## Recommandation & décision
**Option C VALIDÉE par le dry-run.** La cible « conserver >90 % sans casser l'atomicité » est **atteinte
(10 %→100 %)**, la duplication est faible (1,19), les cas >2 sujets rares (1), et Option C **élimine** le seul
cas de mis-attribution observé. C'est exactement l'objectif de ce pas : **arrêter de perdre une information que
MemorIA avait déjà correctement comprise**, sans toucher au juge ni aux seuils.

**Réserve honnête (n'empêche pas V2, cadre V3)** : beaucoup de phrases visite ne mentionnent que 0–1 sujet
canonique (l'autre bout est un terme non-sujet : « carrelage », « démarrage », « revégétalisation »). V2 conserve
tout de même la preuve ; mais le **rendement immédiat de V3** (relation sujet↔sujet) restera faible tant que les
deux bouts ne sont pas des sujets durables. V2 ne perd rien à être fait maintenant ; il rend simplement V3 possible
dès que la matière s'y prête.

**Migration proposée (NON appliquée)** :
```sql
create table public.subject_relational_evidence (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  source_kind   text not null,                    -- field_visit | meeting | historical_pdf
  source_ref_id uuid not null,                    -- report/run
  evidence_text text not null,                    -- verbatim source, borné, SANS reformulation LLM
  subject_ids   uuid[] not null default '{}',     -- canonical_subjects mentionnés (0..N)
  source_proposal_id uuid,                         -- provenance fine si dispo
  created_at    timestamptz not null default now(),
  unique (source_ref_id, md5(lower(evidence_text)))  -- idempotence : rejouer ne duplique pas
);
```
Additif, non destructif, aucun backfill. **Ce que V3 consommera** : lignes à `array_length(subject_ids,1) >= 2`
→ candidat immédiat (cooc=1) → juge relationnel existant → `canonical_subject_links` suggested.

**HARD STOP après spec + dry-run. Aucun code d'écriture, aucune migration appliquée, aucun branchement visite.**
Moteur PV/CR actif et prompt validé non touchés. Prêt à coder Option C sur ton GO.
