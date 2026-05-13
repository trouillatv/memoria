# Admin Monitoring — Design Spec
Date: 2026-05-13

## Contexte

La page `/admin/monitoring` actuelle affiche uniquement un feed brut des 100 derniers événements d'audit. L'objectif est d'y ajouter deux onglets structurés : **Adoption** (qui utilise l'appli, quand, pour quoi) et **Santé opérationnelle** (est-ce que le travail terrain est fait).

## Architecture générale

- Page : `/admin/monitoring/page.tsx` (server component)
- Accès : admin uniquement (garanti par `AdminLayout`)
- Chargement : server-side à chaque visite, pas de refresh automatique
- Période : 7j / 30j / 90j, sélecteur en query param `?period=30` (défaut : 30)
- Data layer : `lib/db/admin-monitoring.ts` (nouveau fichier)
- Les 4 fonctions sont appelées en `Promise.all` à chaque chargement

## Onglet Adoption

### Tableau utilisateurs

Une ligne par user non supprimé (`deleted_at IS NULL`).

| Colonne | Source |
|---|---|
| Nom | `users.full_name` |
| Rôle | `users.role` |
| Dernière connexion | `auth.users.last_sign_in_at` via admin client |
| Actions sur période | `COUNT(audit_log)` WHERE `created_at > now() - period` |
| Statut | `Actif` (action < 7j) / `Dormant` (7-30j) / `Inactif` (jamais ou > 30j) |

Trié par dernière connexion décroissante.

### Répartition des actions

Compteurs simples sur la période :
- Interventions créées (`audit_log` action = `created`, entityType = `intervention`)
- Interventions clôturées (idem, action = `completed`)
- Photos uploadées (count `intervention_photos` WHERE `created_at > period`)
- Anomalies signalées (count `intervention_anomalies` WHERE `created_at > period`)
- Validations effectuées (count `intervention_validations` WHERE `created_at > period`)
- Réinitialisations mot de passe (`audit_log` action = `password_reset_forced`)

### Feed d'activité

`ActivityLogTable` existante enrichie :
- JOIN `users` pour afficher `full_name` au lieu de l'UUID
- Filtre par rôle (select dropdown)
- 100 entrées sur la période choisie, trié desc

## Onglet Santé opérationnelle

### KPI cards (5 métriques)

| Métrique | Calcul |
|---|---|
| Taux de clôture | `COUNT(status IN ['completed','validated']) / COUNT(*) * 100` sur interventions de la période |
| Couverture preuves | Interventions clôturées avec ≥ 1 photo / total interventions clôturées |
| Anomalies ouvertes | `COUNT(intervention_anomalies)` WHERE non résolue |
| Engagements sans mission | Engagements `active` absents de tous les `missions.engagement_ids[]` |
| Interventions en retard | `scheduled_date < today` AND `status = 'pending'` |

### Tableau par contrat

Une ligne par contrat `active`. Colonnes :
- Nom du contrat, Client
- Nb sites couverts
- Interventions planifiées / réalisées sur la période
- Taux de clôture (%)
- Date de la dernière intervention

Trié par taux de clôture croissant (contrats les plus en retard en haut).

### Alertes (conditionnel)

Section visible uniquement si un seuil est dépassé :
- Contrat avec taux de clôture < 70 %
- Chef d'équipe dormant depuis > 7j
- ≥ 5 anomalies ouvertes sur un même site

## Data layer — `lib/db/admin-monitoring.ts`

```ts
getAdoptionStats(period: 7 | 30 | 90): Promise<AdoptionStats>
// users[] avec last_sign_in_at + action counts
// action breakdown (6 compteurs)

getActivityFeed(period: 7 | 30 | 90, roleFilter?: UserRole): Promise<ActivityEntry[]>
// audit_log JOIN users, 100 lignes

getOperationalKPIs(period: 7 | 30 | 90): Promise<OperationalKPIs>
// 5 scalaires

getContractHealthTable(period: 7 | 30 | 90): Promise<ContractHealth[]>
// par contrat actif
```

Appelées en `Promise.all` depuis la page server component.

## Composants UI

- `AdoptionTab` — client component, reçoit `AdoptionStats + ActivityEntry[]`
- `OperationalHealthTab` — client component, reçoit `OperationalKPIs + ContractHealth[]`
- Sélecteur période : `<select>` qui pousse `?period=N` → rechargement server component

## Ce qui n'est pas inclus

- Graphiques temporels / sparklines (ajoutables plus tard)
- Suivi de navigation page-à-page (non loggué)
- Table de métriques précalculées / cron (non justifié au volume PME)
