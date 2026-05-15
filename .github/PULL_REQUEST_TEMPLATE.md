<!--
  MemorIA — PR template
  Doctrine V3 (cf. docs/superpowers/doctrines/planning-doctrine.md)
  « On organise la couverture des engagements. On ne mesure jamais les humains. »
-->

## Résumé

<!-- 1-3 lignes : qu'est-ce que cette PR change et pourquoi -->

## Type de changement

- [ ] Bug fix (correction sans impact sur le comportement métier)
- [ ] Nouvelle feature (ajout de comportement visible utilisateur)
- [ ] Refactor (réorganisation sans changement comportemental)
- [ ] Migration DB (schéma, RLS, index, trigger)
- [ ] Doc / doctrine
- [ ] Test / outillage

## Doctrine V3 — checklist obligatoire

À cocher avant merge. Une seule case non cochée = blocage tant que clarifié.

- [ ] **Aucune fonction `*ByUser` / `*ByAgent` / `rank*` / `*Stats` ajoutée.** L'asymétrie « événement vs personne » est respectée : on lit les participants d'une intervention, jamais l'inverse.
- [ ] **Aucun export n'expose une identité agent par défaut.** Toute donnée nominative dans un export Excel, PDF, CSV ou JSON public est anonymisée (équipe + cardinalité, pas de noms) sauf override admin avec justification écrite.
- [ ] **Aucune nouvelle route `/users/[id]` ou `/agents/[id]` créée.** La personne n'apparaît jamais comme sujet principal d'une vue. Seule exception : `/account` (l'utilisateur lui-même).
- [ ] **Aucun mot banni ajouté à l'UI** : *présent / absent / disponible / retard / pointage / check-in / responsable / chef / lead / senior / ponctualité / productivité / actif / classement / score*.
- [ ] **Aucune agrégation au niveau utilisateur** (`user.total_interventions`, `user.completion_rate`, `user.last_active_at`, etc.). Aucun calcul humain.

## Tests

- [ ] `npm run typecheck` passe
- [ ] `npm test` passe (incluant `tests/doctrine/*.test.ts`)
- [ ] Tests ajoutés/modifiés couvrent le changement

## Si migration DB

- [ ] RLS testée pour chaque rôle (admin, manager, chef_equipe)
- [ ] Pas d'index sur user_id seul (anti reverse-lookup marqueur doctrinal)
- [ ] Trigger d'immuabilité si donnée liée à une preuve (`completed` / `validated`)

## Si UI

- [ ] Wording vérifié contre la table doctrine V3 (autorisé/interdit)
- [ ] Aucun lien sortant depuis un nom d'agent
- [ ] États empty/loading/error explicites

## Si export ou route publique

- [ ] Whitelist de colonnes documentée
- [ ] Anonymisation par défaut (cardinalité d'équipe, pas noms)
- [ ] Audit log si override d'anonymisation

---

<!-- Lien vers issue/spec si applicable : Closes #N -->
