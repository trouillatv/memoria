# P2 — Diagnostic READ-ONLY : conflation Registre ↔ Contrôle électrique

Date : 2026-08-27. READ-ONLY. Aucun UPDATE / rematching / code. Doctrine A/B. Site Bella Napoli.
Sources : `_p2-audit-conflation.mjs`, `_p2-repro-phase.mjs`.

## La chaîne exacte (8 points)

1. **Proposition source + preuve** : action, thread `150b9e29`, label « Contrôles électriques,
   éclairage et cuisson à refaire », description « Les contrôles des installations électriques, de
   l'éclairage de sécurité et des appareils de cuisson sont en retard et doivent être refaits
   immédiatement. » — run 2025 (`79a735e1`), `effective_date=2025-08-05`.
2. **Thread initial** : `150b9e29` (propre, distinct — pas un problème de threading).
3. **Canonical subject choisi** : « Registre de sécurité installations électriques non renseigné »
   (`71db6b00`), `kind=business_subject`, créé en **2024** depuis une *observation* (thread `85b42d12`,
   « Registre de sécurité non renseigné pour les installations électriques »).
4. **Phase responsable** : **Phase 1.5 `matchExistingSubject`** (LLM Gemini, liste fermée, seuil 0.85).
   Prouvé par élimination (offline) : Jaccard brut = **0.100** (seul token commun « électriques ») →
   Phase 1 déterministe = **not_found** (ni exact, ni ancre, ni code, ni Jaccard ≥ 0.35) ; Jaccard
   normalisé = **0.100 < 0.35** → « Registre » **jamais candidat P0-1** → `analyzeSubjectPair`
   (Phase 1.6) **jamais appelé**. Seule Phase 1.5, qui reçoit **toute** la liste des CS sans préfiltre
   lexical, a pu matcher.
5. **Raison exacte du match** : le prompt de `matchExistingSubject` demande « cet événement est-il une
   **manifestation, une évolution ou une échéance** d'un de ces sujets ? » sur la liste complète, avec
   la règle « ne crée jamais un nouveau sujet, retourne un existant ou null ». Il **n'a aucun garde-fou
   « même objet ≠ même thème/domaine »** et **aucun contre-exemple** (contrairement à
   `analyzeSubjectPair` qui en a). Une action « contrôles électriques à refaire » se lit naturellement
   comme une « évolution/échéance » du **thème électrique** → le LLM (confiance ≥ 0.85) la rattache au
   seul sujet électrique présent, « Registre… ». **Facteur aggravant** : au moment du match 2025, le bon
   sujet « Contrôle des installations électriques » **n'existait pas encore** (créé plus tard par la
   réparation P1-C1b) — le LLM a donc pris le plus proche voisin de domaine.
6. **Distinguables à partir des données au moment du match ?** **OUI.** Les libellés portent les mots
   discriminants (« Registre… non renseigné » = tenue documentaire vs « Contrôles… à refaire » = acte
   technique). `analyzeSubjectPair`, avec ses contre-exemples, aurait répondu `related`. La donnée
   suffisait ; c'est le **prompt de Phase 1.5 qui manque le garde-fou**.
7. **Reproductible génériquement ?** **OUI.** `matchExistingSubject` propose toute la liste des CS avec
   un cadrage large (« manifestation/évolution/échéance ») et sans garde « même objet ». Tout fait de
   **contrôle/vérification** peut se rattacher à un sujet **registre/rapport/réserve/document** du même
   domaine/équipement.
8. **Autres conflations dans Bella Napoli** : **aucune autre**. Les CS multi-threads restants
   (Nettoyage, Friteuse, Extincteurs, Cuisson, Séparation flux, Dégagement Mall) regroupent des
   **facettes du même objet** — pas des objets distincts. La conflation « Registre » est isolée.

## Impact Géant (VGP / SSI / portes CF)

**Risque élevé et systématique.** Sur ces corpus coexistent, pour un même équipement : le contrôle, le
rapport de vérification, le registre de sécurité, la réserve, l'équipement lui-même. Sans garde-fou,
« Contrôle SSI à refaire » se rattacherait à « Registre SSI » ou « Rapport SSI » ; « Réserve sur portes
CF » à « Contrôle portes CF ». Conflation en série de réalités distinctes → lignes de vie fausses.

## Cause racine (MÉCANISME, doctrine B)

`matchExistingSubject` (Phase 1.5, partagée historique + field_visit) sur-fusionne un fait sur un sujet
**du même domaine mais d'objet distinct**, parce que son prompt (a) pose une question large
(manifestation/évolution/échéance), (b) n'exige pas le **même objet physique/administratif**, (c) n'a
aucun contre-exemple, (d) préfère le plus proche voisin de domaine à un `null` quand le bon sujet
n'existe pas encore. Aucune réparation Bella Napoli seule ne corrige cela.

## Proposition — plus petit correctif générique (B), avec garde-fous

**B (workflow)** : renforcer `SYSTEM_PROMPT_MATCH_EXISTING` (une seule brique, partagée) avec la
doctrine déjà éprouvée dans `analyzeSubjectPair` :
- exiger le **même objet réel** (physique/opération/obligation), pas seulement le même thème/domaine ;
- **contre-exemples fermés** : un **registre / rapport / document / réserve** n'est PAS le même sujet
  que le **contrôle / la vérification / l'équipement** qu'il concerne → retourner `null` ;
- conserver le seuil **0.85 inchangé** (baisser fragmenterait) et la règle « existant ou null » (ne
  jamais créer ici) ; en cas de doute, `null` → la Phase 2 créera le bon sujet métier.

**Anti-fragmentation** : le garde ne cible que le **cross-type** document↔contrôle/équipement ; les
vrais rattachements même-objet (« Contrôle extincteurs OK » → « Contrôle des extincteurs ») doivent
continuer à matcher. Tests des DEUX directions obligatoires.
**Anti-sur-fusion** : le garde EST l'anti-sur-fusion ; il transforme les faux `same` de domaine en
`null` → création d'un sujet distinct.

**A (réparation Bella Napoli, APRÈS validation du fix)** : déplacer l'occurrence/thread 2025
« Contrôles électriques à refaire » de « Registre… » vers « Contrôle des installations électriques »
(`2504ad1f`, créé en P1-C1b) → le sujet contrôle électrique traverserait 2024 (BV) + 2025 (à refaire),
`spanning_both 4 → 5` ; « Registre… » ne conserverait que son observation 2024 (sans occurrence — cf.
P3, éligibilité observation). À faire seulement après B validé, avec snapshot + rollback.

## Limites / liens

- Ne pas confondre avec P3 : « Registre » n'a pas d'occurrence 2024 car l'observation n'est pas éligible
  (P3, séparé). P2 traite l'**over-fusion** ; P3 l'**éligibilité**.
- Le nouveau semantic-fallback P1-C2b (avec CAUTION) ne voit jamais ce cas : Phase 1.5 matche **avant**
  lui. Le correctif doit donc être **dans Phase 1.5**, pas dans le fallback.

**HARD STOP.** Diagnostic seul. Aucun UPDATE, rematching ni code avant validation.
