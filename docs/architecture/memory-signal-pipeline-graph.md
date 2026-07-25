# Memory Signal Pipeline

Ce document donne une vue graphique du moteur de signaux de MemorIA. Il sert de carte commune pour les lots futurs: `Promise`, `Question`, `Contradiction`, `Staleness`, `Health`, etc.

## Chaîne actuelle

```mermaid
flowchart LR
  DB[(Base de donnees)]
  RM[getStructuredPromiseRecords()]
  B[buildPromiseCandidates()]
  D1[PromiseExpiredDetector]
  D2[PromiseNeedsConfirmationDetector]
  R[DetectorRunner]
  MS[MemorySignal[]]
  UI[Dashboard / presenters]

  DB --> RM --> B --> D1
  B --> D2
  D1 --> R
  D2 --> R
  R --> MS --> UI
```

## Frontieres de responsabilite

```mermaid
flowchart TB
  subgraph ReadModel["Read model DB"]
    RM1[getStructuredPromiseRecords()]
  end

  subgraph Builder["Builder"]
    B1[buildPromiseCandidates()]
  end

  subgraph Detectors["Detecteurs purs"]
    D1[PromiseExpiredDetector]
    D2[PromiseNeedsConfirmationDetector]
  end

  subgraph Runner["Orchestration"]
    R1[DetectorRunner]
  end

  subgraph Surfaces["Surfaces"]
    U1[Dashboard]
    U2[Future: fiche chantier]
    U3[Future: notifications]
    U4[Future: briefing visite]
  end

  RM1 --> B1 --> D1
  B1 --> D2
  D1 --> R1
  D2 --> R1
  R1 --> U1
  R1 --> U2
  R1 --> U3
  R1 --> U4
```

## Familles prevues

| Famille | Role |
|---|---|
| `PromiseDetector` | Engagements echus ou a confirmer |
| `QuestionDetector` | Questions ouvertes ou attentes explicites |
| `ContradictionDetector` | Faits incompatibles entre lectures recentes |
| `StalenessDetector` | Informations vieillissantes |
| `ReserveDetector` | Reserves sans preuve de levee |
| `CompanyDetector` | Intervenants ou entreprises incomplets |
| `PlanningDetector` | Preparation et echeances a traiter |
| `HealthDetector` | Synthese globale de l'etat du chantier |

## Regle de fond

Le dashboard ne doit pas comprendre les regles de detection. Il consomme seulement `MemorySignal[]` et les presente.

Quand une nouvelle famille apparait, elle doit:

1. lire ses donnees via un read model dedie si besoin;
2. fabriquer des candidats structures;
3. produire des `MemorySignal`;
4. se brancher sur le meme runner;
5. alimenter toutes les surfaces qui consomment les signaux.

