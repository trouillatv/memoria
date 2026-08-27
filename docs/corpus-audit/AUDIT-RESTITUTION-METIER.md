# Audit restitution métier post-R-1 — diagnostic, cartographie, plan P0-P3

Date : 2026-08-28. READ-ONLY. Aucun code. Objectif : faire converger le produit autour du modèle
longitudinal fiabilisé par R-1 (occurrences), pour que David (chef de projet / conducteur) réponde vite
à : *qu'est-ce qui mérite mon attention / reste à faire / a changé / pourquoi / qui fait quoi pour quand.*

## 0. Constat central

R-1 a fait de `canonical_subject_occurrence` la source longitudinale unique pour **deux** consommateurs
(`getCanonicalSubjectLife` = ligne de vie/fiche ; `getNavigableSubjectsForSite` = grille/Aperçu/briefing).
**Trois autres read-models reconstruisent encore la trajectoire depuis `document_extraction_proposal`** et
peuvent donc raconter une histoire **différente** du même sujet :

| Read-model | Fichier | Alimente | Dette |
|---|---|---|---|
| `getSiteHealthTimeline` | `lib/documents/site-synthesis.ts` | **Évolution / « Tension du chantier »** | proposal-first + **viole non-mention ≠ résolu** |
| `getPvDelta` | `lib/documents/pv-comparison.ts` | **Chronologie** (« Depuis le dernier PV ») | proposal-first, ignore state_status/event_date |
| `getSiteSubjectMatrix` | `lib/documents/pv-history.ts` | **Lignes de vie** (matrice) + delta | proposal-first (1 état/run, document_status) |

C'est la dette R-1 résiduelle **et** la principale cause de contradictions inter-vues. « Même sujet, même
histoire partout » n'est pas encore vrai : matrice / chronologie / tension peuvent diverger de la fiche.

## 1. Cartographie (où la vérité est recalculée différemment)

```
canonical_subject (identité durable)
  └─ canonical_subject_occurrence  ← VÉRITÉ longitudinale (state_key, state_status, event_date, source_page, thematic_category, acteurs)
       ├─ getCanonicalSubjectLife ........... Fiche / Ligne de vie ......... ✅ occurrence-first (R-1)
       ├─ getNavigableSubjectsForSite ....... Grille, Aperçu(attention), Briefing, Lignes-de-vie(natif) ✅ occurrence-first (R-1)
       │     └─ deriveSiteAttentionItems / deriveCanonicalAttentionItems → « Ce qui demande votre attention »
       │     └─ visit-briefing.ts (déterministe, 0 LLM) → « Préparer ma visite »
       └─ objets matérialisés (site_actions/decisions/reserve/deadlines) via report→run + materialization
             └─ site-overview.ts → « Que reste-t-il à faire ? » (action-first, dédup thread)
             └─ actions-dashboard + action-provenance.ts → Actions (« Pourquoi cette action ? » ✅ existe)

document_extraction_proposal (matière d'extraction / preuve / inbox)  ← NE DOIT PLUS être source de trajectoire
       ├─ getSiteHealthTimeline → « Tension du chantier » ................ ❌ proposal-first + faux positif
       ├─ getPvDelta → Chronologie « Depuis le dernier PV » ............. ❌ proposal-first
       └─ getSiteSubjectMatrix → Lignes de vie (cellules/transitions) ... ❌ proposal-first
```

Points où **une même information est recalculée avec des règles différentes** :
- **état d'un sujet** : tri-state `state_status` (fiche/grille) vs `document_status→transition` (matrice/chronologie/tension).
- **transition** : `computeHistoryTransition` sur tri-state (fiche) vs `computeTransition`/`computeCanonicalTransition` sur document_status (chronologie/matrice/tension).
- **présence/comptage** : axe documentaire (R-1) vs comptage de propositions non-nulles (tension).

## 2. Findings par surface (résumé ; détail dans les rapports d'exploration)

- **Aperçu** ✅ occurrence-first, jargon propre. « Attention » = niveau **sujet** (fusion de signaux) ;
  « Reste à faire » = niveau **action** (dédup thread). Divergence **légitime mais non expliquée** : David
  ne voit pas la chaîne SUJET → état → raison → action. (P1)
- **Tension du chantier** ❌ **P0 confirmé** : `site-synthesis.ts:700` `if (status !== null)` — un sujet
  non-mentionné (status null) sort du compte → la courbe **baisse sur le silence**. « −38 % depuis le pic »
  peut être piloté par des non-mentions. Contredit *non-mention ≠ résolu*. Proposal-first.
- **Chronologie** ❌ proposal-first (`getPvDelta`), style diff technique. **Narration déterministe possible**
  (structure delta auto-suffisante, LLM optionnel). (P0 convergence + P2 récit)
- **Lignes de vie** ❌ matrice proposal-first ; occurrences natives seulement en surimpression. États/
  transitions peuvent diverger de la fiche R-1. Vue experte à **conserver** mais fiabiliser. (P0)
- **Actions** ✅ chaîne « Pourquoi cette action ? » existe (`action-provenance.ts`), « À affecter » explicite,
  0 fabrication. Manque : échéance absente = vide silencieux (pas de « à définir »). (P1 mineur)
- **Fiche sujet** ✅ occurrence-first (R-1). Jargon à revoir : « Fait de connaissance » (B), noms de
  transition internes (nouveau/aggravé/maintenu/réapparu/changé — C), tri-state « Résolu/Indéterminé » (C).
- **Préparer ma visite** ✅ déterministe, 0 LLM, 0 fabrication. **Risque** : `isProvenOpen(unknown,0)=false`
  → un sujet non-mentionné sans objet actif **disparaît** du briefing (mitigé partiellement par la stagnation
  ≥30j). Contredit « à vérifier sur place ». (P1)
- **Mémoire** ✅ confirmé = occurrence-first (objets réels), inbox = proposal-first (assumé). Écran principal
  = **dump** ; synthèse thématique seulement à la demande (LLM). Regroupement par `thematic_category` (R-1)
  + fallback famille **faisable déterministiquement**. (P2)
- **Intervenants** ✅ engagement (FK structurel) vs présence historique (événements datés) bien séparés,
  0 fabrication. **Doublon Bureau Veritas / Véritas** = 2 lignes `companies` : `findOrCreateCompanyByName`
  (`companies.ts`) utilise `.ilike('name')` **sensible aux accents**, `normalizeActorLabel` existe mais
  n'est **pas appelé**. Pas de canonicalisation acteur (choix assumé). (P1-data, ne pas fusionner à l'aveugle)

## 3. Vocabulaire — grammaire produit proposée (à valider)

| Terme actuel | Classe | Direction |
|---|---|---|
| Ouvert / Résolu / En cours / Clôturé / Non conforme / Annulé | A (métier) | garder |
| Réserve / Action / Décision / Échéance / Observation | A | garder |
| **Fait de connaissance** (knowledge_fact) | B (expert) | remplacer côté user par « Constat » / « Information » ; garder en vue experte |
| **Transitions** internes (nouveau, aggravé, maintenu, réapparu, changé, non_mentionné, réouvert) | C | masquer en vue standard, réserver à Lignes de vie (experte) ; garder « Réouvert » et « Non mentionné » qui sont métier |
| **Indéterminé** (unknown tri-state) | C | côté user : « À vérifier » plutôt que « Indéterminé » |
| state_key / objet métier / proposition | C | jamais visibles (déjà le cas) |

Langage principal = **état actuel · changement · action · preuve · incertitude**. Vue experte (Lignes de vie)
peut garder l'ontologie fine.

## 4. Plan P0-P3 (lots petits, testables, réversibles)

**P0 — vérité / contradiction / risque de décision erronée**
- **P0-1** Tension : supprimer le faux positif *non-mention = amélioration*. Option a : ne plus faire baisser
  la courbe sur une non-mention (un sujet ouvert non-mentionné reste compté « à vérifier ») ; option b :
  renommer/reframer la métrique et expliciter l'incertitude. → décision produit avant code.
- **P0-2** Convergence read-model transverse : basculer `getSiteHealthTimeline`, `getPvDelta`,
  `getSiteSubjectMatrix` sur les occurrences (state_status + non-mention doctrinale + event_date), OU au
  minimum aligner leur sémantique d'état/transition sur R-1. C'est le plus gros lot (backbone `pv-history`).
- **P0-3** Parité inter-vues sur 5 témoins Bella (A-E ci-dessous) : documenter ce que CHAQUE surface doit
  afficher, puis vérifier l'égalité de l'histoire.

**P1 — compréhension opérationnelle**
- Aperçu : rendre visible la chaîne SUJET → état → raison → action(s) (réutiliser les composants existants).
- Fiche sujet : hiérarchiser (état actuel → synthèse → reste à faire → responsable/échéance → pourquoi →
  ligne de vie → objets → preuves).
- Préparer ma visite : garder les non-mentionnés-non-résolus comme « à vérifier » (ne pas les laisser tomber).
- Intervenants : présenter dernière intervention / sujets liés / actions actuelles (0) explicitement.
- Bureau Veritas : diagnostiquer (fait) + proposer normalisation à l'écriture ; **ne pas fusionner en prod
  sans validation**.

**P2 — simplification / présentation**
- Grammaire de vocabulaire (§3).
- Chronologie : récit déterministe des changements significatifs (listes détaillées en 2ᵉ niveau).
- Mémoire : synthèse thématique déterministe (thematic_category ?? famille) avant le registre exhaustif.

**P3 — polish** desktop/mobile, densités, libellés fins.

## 5. Témoins de parité transverse (Bella) — à documenter puis vérifier

| # | Sujet | Attendu longitudinal |
|---|---|---|
| A | Contrôle installations électriques | resolved (22/03/2024) → open/reopened (05/08/2025) |
| B | Contrôle appareils de cuisson | état historique → à refaire |
| C | Nettoyage conduits extraction | historique + action/échéance associée |
| D | Séparation flux public/personnel | cas non-mention (ne doit PAS apparaître comme résolu) |
| E | Contrôle éclairage de sécurité | apparition + activité terrain |

Pour chacun : Aperçu / Actions / Chronologie / Histoire / Lignes de vie / fiche / Évolution / Préparer /
Mémoire / attention / mobile / desktop doivent raconter la **même** temporalité et le **même** état.

## 6. Ordre d'implémentation proposé (à confirmer)

1. ~~R-1 Phase B / getNavigableSubjectsForSite~~ — **DÉJÀ FAIT** (commit a641f0f6).
2. **P0-1 Tension** (petit, fort risque de décision erronée) — décision produit puis fix.
3. **P0-2 convergence pv-history/pv-comparison/site-synthesis** (gros lot, backbone) — avec baseline/parité.
4. P1 Aperçu (chaîne sujet→action).
5. P1 fiche sujet (hiérarchie + vocabulaire).
6. P1 Préparer ma visite (non-mention).
7. P2 Chronologie (récit déterministe).
8. P2 Mémoire (synthèse thématique).
9. P1 Intervenants (+ P1-data Bureau Veritas).
10. P2 vocabulaire transverse + polish desktop/mobile.

**HARD STOP — aucun code écrit. Décision attendue : validation du diagnostic + de l'ordre, et arbitrage
P0-1 (Tension : corriger la métrique vs reframer/renommer).**
