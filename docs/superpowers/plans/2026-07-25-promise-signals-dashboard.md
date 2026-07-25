# Promesse Signals Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Exposer les promesses expirées et les annonces anciennes à confirmer dans le dashboard.

**Architecture:** Read model séparé, builder séparé, détecteurs purs, runner de déduplication et presenters.

**Tech Stack:** Next.js, TypeScript, Supabase, Vitest.

---

### Task 1: Protocole commun

**Files:** Create lib/memory/signals/detector.ts; modify lib/memory/signals/operational-contract.ts; test tests/lib/memory-signal-detector-contract.test.ts.

- [ ] Écrire d’abord le test du protocole et du trigger promise_without_due_date.
- [ ] Vérifier son échec avec npx vitest run tests/lib/memory-signal-detector-contract.test.ts.
- [ ] Ajouter MemorySignalDetector<TContext> avec id, version et detect(context, now).
- [ ] Vérifier le passage, puis committer.

### Task 2: Candidats sans échéance

**Files:** Modify lib/memory/signals/promise-candidates.ts; test tests/lib/memory-signal-promise-candidates.test.ts.

- [ ] Tester une promesse qualifiée avec dueAt null, une date invalide et un titre vide.
- [ ] Vérifier l’échec.
- [ ] Autoriser dueAt = null sans jamais lire body.
- [ ] Relancer les tests candidats et détecteur, puis committer.

### Task 3: Détecteurs

**Files:** Create lib/memory/signals/promise-follow-up-detector.ts; modify lib/memory/signals/promise-detector.ts; tests dédiés.

- [ ] Tester promise expirée, promesse future, annonce ancienne sans date, annonce récente, confirmation, preuve liée et exclusivité.
- [ ] Implémenter detectPromiseExpiredSignals et detectPromiseNeedsConfirmationSignals.
- [ ] Le second signal utilise promise_without_due_date, warning, week, investigate, rules et une clé stable.
- [ ] Vérifier les tests et committer.

### Task 4: Runner

**Files:** Create lib/memory/signals/detector-runner.ts; test tests/lib/memory-signal-detector-runner.test.ts.

- [ ] Tester l’exécution, la fusion et la déduplication uniquement par dedupeKey.
- [ ] Implémenter DetectorRegistration<TContext> et runSignalDetectors sans DB.
- [ ] Vérifier gravité maximale, union des sources/actions et conservation de la détection la plus ancienne.
- [ ] Vérifier les tests et committer.

### Task 5: Read model

**Files:** Create lib/db/promise-candidates.ts; test tests/lib/db/promise-candidates.test.ts.

- [ ] Tester captured_knowledge(kind = promise) active sans date, les deadlines qualifiées, les deadlines génériques, les statuts terminaux, les organisations étrangères et les sources.
- [ ] Implémenter getStructuredPromiseRecords(organizationIds, siteIds?) avec filtrage organisation/site.
- [ ] Lire uniquement les colonnes structurées ; utiliser created_at comme occurrence ; ne jamais extraire une date du texte.
- [ ] Mapper les qualifications de site_knowledge_proposals(kind = deadline) uniquement si engagement explicite et payload.dueAt timezone-aware.
- [ ] Vérifier les tests et committer.

### Task 6: Pipeline

**Files:** Create lib/memory/signals/promise-pipeline.ts; test tests/lib/memory-signal-promise-pipeline.test.ts; modify app/(dashboard)/dashboard/page.tsx.

- [ ] Tester records → builder → deux détecteurs → runner.
- [ ] Implémenter une composition pure detectPromiseSignalsFromRecords(records, now).
- [ ] Brancher le read model autorisé dans la page dashboard et fusionner avec les signaux existants.
- [ ] Vérifier qu’aucune promesse n’entre dans À faire maintenant sans signal priority + direct distinct.
- [ ] Vérifier et committer.

### Task 7: Présentation Attention

**Files:** Modify lib/memory/signals/fact-selectors.ts, lib/memory/signals/surface-presenters.ts, app/(dashboard)/dashboard/DashboardPremium.tsx; tests presenters et composant.

- [ ] Tester les libellés Promesse non confirmée et Annonce à confirmer, avec absence de retard pour la seconde.
- [ ] Ajouter le sélecteur de fait promesse et le wording par trigger.
- [ ] Montrer source, chantier, organisation et actions disponibles ; réutiliser les workflows existants sans mutation dashboard spécifique.
- [ ] Vérifier et committer.

### Task 8: Vérification finale

**Files:** aucun fichier hors périmètre.

- [ ] Lancer la suite Vitest ciblée.
- [ ] Lancer le typecheck filtré sur les modules touchés.
- [ ] Lancer git diff --check.
- [ ] Vérifier que seuls les fichiers de la feature sont stagés et pousser après validation.

