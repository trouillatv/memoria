# Phase 11 — Dashboard cockpit

**Date** : 2026-05-12 (closed)
**Branche** : feat/dashboard-cockpit

## Quoi

Le dashboard `/dashboard` devient un cockpit du matin qui répond aux 4 questions
du DG : « tout tient ce matin ? », « où regarder ? », « qu'a-t-on accompli ? »,
« mon capital de preuves grandit ? ».

## Pourquoi

Le dashboard précédent affichait une liste de contrats avec barres de progression
— inventaire d'état, sans narratif. Le DG ouvrait `/dashboard`, ne savait pas
quoi en faire, allait directement à `/contracts` ou `/tenders`. Le dashboard
n'avait pas de pulse, pas de signal d'action, pas de mémoire des wins.

## Stack

- `lib/db/dashboard.ts` (879 lignes) — 7 helpers DB : `getWeekPulse`,
  `getCapitalPreuves`, `getAOPipeline`, `getOpenAnomaliesStats`,
  `getAtRiskEngagements`, `getContractsUnderTension`, `getRecentActivity`
- Queries parallèles dans `page.tsx` via `Promise.all`
- 6 widgets composants : `DashboardHeader`, `StatsBand`,
  `AtRiskEngagementsWidget`, `ContractsUnderTensionWidget`,
  `RecentActivityWidget`, `AnomaliesOldWidget`
- `WelcomeCard` (Slice C.3) préservée pour les nouveaux tenants (zéro contrat)

## Layout final

```
[ Header chaleureux + date FR ]
[ Bandeau 4 stats : Cette semaine · Capital · AO · Anomalies ]
[ Engagements à surveiller ]   ← si >0
[ Contrats sous tension ]      ← si >0
[ Activité récente ]
[ Anomalies +3 jours ]         ← si >0
[ Sections contrats existantes — préservées ]
```

## Doctrine V3 respectée

- Test ultime « identifiants abstraits » passe sur tous les widgets
- Aucun nom d'agent dans les labels d'activité (test regex prénom)
- Centré sur engagement / contrat / intervention
- Pas de « performance », « productivité », « ranking », « top contributeurs »
- Sobriété : pas de couleur rouge alarmante, ambre uniquement pour signaux
- Silence positif : widgets disparaissent quand vide (pas de « Aucun X »)

## Décisions clés

- `getAtRiskEngagements` en MVP : seule détection `no_intervention_recent`
  implémentée. `deadline_close` et `high_skip_rate` reportés (champs DB
  manquants pour deadline, complexité join pour skip rate).
- `getContractsUnderTension` : score boucle de preuve = moyenne arithmétique
  simple des 5 segments. Pondération uniforme = lisible et défendable en MVP.
- `getRecentActivity` : 6 types d'événements en union triée par timestamp DESC.
  Limit défaut 8 dans le widget.
- `WelcomeCard` prend la place du cockpit si zéro contrat actif — onboarding
  d'abord, cockpit après.

## Limites connues

- Format relatif de date est calculé côté serveur — pas de mise à jour live
  côté client (cohérent doctrine « pas de temps réel anxiogène »).
- `AnomaliesOldWidget` pointe vers `/missions?status=in_progress` faute de
  route `/anomalies` dédiée.
- Pas de comparaison « vs semaine dernière » sur les stats — refusé en V1
  doctrine pour éviter glissement vers KPI.

## Paramètres par défaut

- Pulse semaine = lundi → dimanche en cours (UTC pour stabilité SQL)
- « +3 jours » sur anomalies = 72 heures
- `getRecentActivity(8)` = 8 événements par défaut
- `getAtRiskEngagements()` = max 5
- `getContractsUnderTension()` = max 5

## Validation finale

- `npm run typecheck` : 0 erreur
- `npx vitest run` : 57 fichiers passed, 1 skipped — 516 tests passed, 4 skipped
- Grep anti-pattern doctrine V3 : aucun match (productivité, agent, byUser,
  byAgent, rank, performance individu, top agent, classement)
- Grep prénoms typiques sur fichiers Phase 11 (hors tests) : aucun match

## Suite

- Pilote terrain réel (priorité absolue) — observer si le dashboard cockpit
  est utilisé naturellement
- Phase 11.bis (post-pilote uniquement) : `deadline_close` + `high_skip_rate`
  si demandé par observation terrain
- Pas de Phase 12 anticipée — le prochain cycle est guidé par le terrain
