# 01 — Modèle des objets métier (état réel du code)

> Audit 2026-07-13, post-session Guillaume. Faits vérifiés (fichier:ligne).
> Référence pour toute évolution — corrige ce document si le schéma change.

## La grammaire en une page

```
Organisation (tenant)                      organizations (mig 089)
└── Client (l'entreprise cliente)          clients — name NOT NULL
    └── Site (le LIEU durable)             sites — client_id NOT NULL (CASCADE)
        ├── Contrat                        contracts — client_name TEXTE LIBRE (pas de FK client !)
        ├── Dossier (l'OPÉRATION)          dossiers (mig 172) — client_id nullable ≠ client du site
        ├── Mission (le CADRE du travail)  missions — deleted_at, active
        │   ├── Rythme                     intervention_templates — deleted_at
        │   └── Intervention (l'OCCURRENCE) interventions — PAS de deleted_at ; statuts :
        │       │                            planned → in_progress → completed → validated
        │       │                            + skipped (021) ; PAS de 'cancelled'
        │       └── Preuves                intervention_photos / checklist / anomalies / validations (CASCADE)
        ├── Réunion (DÉCIDER)              site_reports origin IS NULL
        ├── Visite (OBSERVER)              site_reports origin IS NOT NULL (planned/spontaneous/qr/gps)
        │   ├── Captures                   visit_capture (photo/video/vocal/note/verification/position)
        │   ├── À vérifier                 visit_watchlist (mig 196)
        │   └── Pièces                     site_report_attachments (CASCADE sur report)
        ├── Action (l'ENGAGEMENT)          site_actions — report_id nullable (détachable)
        ├── Décision                       site_decisions (mig 136)
        └── Réserve                        site_reserve
```

## Les verbes métier (doctrine officielle — validée Vincent 2026-07-13)

Tout objet répond à UNE question. Un écran qui mélange deux verbes est suspect.

| Objet | Verbe | Question à laquelle il répond |
|---|---|---|
| Réunion | **décider** | « Nous venons décider avec les autres » |
| Intervention | **exécuter** | « Qu'est-ce que je viens faire aujourd'hui ? » |
| Visite | **observer** | « Je viens voir où en est le chantier » |
| Mission | **organiser** | « Quel est le cadre du travail sur ce chantier ? » |
| Planning | **coordonner** | « Qui va où, quand ? » |
| Action | **engager** | « Qu'avons-nous promis de faire ? » |

- Une **mission** = la nature/cadre récurrent du travail ; une **intervention** = une
  occurrence datée. Le mobile masque le mot « mission » (mission système ponctuelle,
  `ponctuel-actions.ts:74`).
- Une **visite** constate (« l'action n'est toujours pas faite ») mais n'exécute
  jamais ; l'exécution vit dans l'intervention.
- Une **action** est un engagement transversal — elle naît en réunion/visite et
  survit à son origine (`report_id` détaché au besoin, `meetings/actions.ts:23`).

## Chaîne de prérequis à la planification (fait, pas opinion)

En base, UN seul prérequis dur : `interventions.mission_id` FK NOT NULL
(`lib/db/interventions.ts:231-256`). D'où la chaîne :

```
client → site (client_id NOT NULL, organization_id NOT NULL applicatif) → mission → intervention
```

**L'équipe n'est PAS un prérequis à la planification** : la contrainte 048
(`048_intervention_team_required_for_in_progress.sql:14-19`) n'exige
`assigned_team_id` qu'à partir de `in_progress`. Une intervention `planned`
« Non-affecté » est légale (et la vue semaine la gère). Le blocage équipe du lanceur
mobile (`InterventionLauncher.tsx:60`) est un choix d'UI, pas une contrainte.

## Pièges connus du modèle

1. `contracts.client_name` = texte libre sans FK — le « client » d'un contrat peut
   diverger du client réel du site (voir 06-client-site.md).
2. Client « Interne » = contournement du `client_id NOT NULL` (tripwire posé).
3. `sites.tenant_id` = UUID legacy PARTAGÉ entre orgs (mig 059/061) — ne JAMAIS
   l'utiliser pour l'isolation ; c'est `organization_id` (mig 089) qui isole.
   Les RPC vectorielles filtrent encore sur tenant_id (chantier « vague 3 » ouvert).
4. `team[]` (array) sur interventions = legacy distinct de `assigned_team_id`
   (le vrai champ, `lib/db/interventions.ts:245-248`).
5. `site_actions` / `site_decisions` n'ont PAS d'organization_id — scopées via site.

## Planning : état actuel vs cible (DOCUMENT SEULEMENT — aucun code)

Aujourd'hui :

```
Mission (cadence indicative)
  └── intervention_templates (rythme : frequency, day_of_week, heure)
        └── Génération PARESSEUSE, max 7 jours d'avance, idempotente
            (intervention-templates.ts:1-15 — doctrine gravée)
              └── Interventions matérialisées → Équipe (au démarrage)
```

Ce qu'un planning cyclique demanderait (chantier SÉPARÉ, non commencé) :

```
PlanningTemplate → PlanningCycle → CycleDay/CycleSlot → Assignment
                                     └── GeneratedOccurrence + Exception
```

Décision architecturale à instruire à ce moment-là : matérialiser toutes les
occurrences futures VS conserver le cycle abstrait et ne matérialiser que les
occurrences proches. **Le code actuel a déjà choisi la 2e voie** (génération
paresseuse 7 jours) — le futur chantier devra soit l'étendre, soit le remplacer,
jamais les deux en parallèle. À concevoir depuis l'usage réel de Guillaume,
après la vague d'adoption.
