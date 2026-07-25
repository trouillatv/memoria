# Où l'on teste — et où l'on ne teste jamais

**La règle, en une phrase : aucun test ne s'écrit dans le tenant d'un utilisateur réel.**

Ce n'est pas de l'hygiène de base de données. Quand MemorIA propose des actions,
alimente un planning et écrit une mémoire, une donnée de test n'est plus « une ligne
dans une table » : elle contamine la vision qu'un conducteur a de SON chantier.
Devant un bug, il se demandera « est-ce encore une donnée de test ? » — et il aura
raison de douter de tout le reste. La confiance se perd une fois.

## Les tenants

| Tenant | Comptes | Ce qu'on y fait |
|---|---|---|
| **Démo MemorIA** (`demo`) | `demo@memoria.nc`, `demo-chef@memoria.nc` | Développement, recettes, captures, essais IA, démonstrations. Tout y est jetable. |
| **AGP** | `guillaume.demene@memoria.nc`, `vincent.trouillat@memoria.nc` | **Données réelles uniquement.** Zéro écriture de développement. |
| Becib, BatiSud, ContraBat | pilotes | Idem : on n'y écrit pas. |

`Lycée PETRO ATTITI` (tenant AGP) est le chantier de **démonstration** : rendu PDF,
qualité des synthèses, captures, comparaisons avant/après. On le lit, on n'y mute rien.

## Recette de démonstration du tenant `demo`

La démo `demo@memoria.nc` est le seul environnement qui peut être réinitialisé.
Le reset démarre toujours par un backup de sécurité, puis reconstruit un scénario
reproductible et vérifié en fin de seed.

```text
backup-export.ts
      ↓
reset-and-seed-demo-tenant.ts
  ├─ seed base du tenant
  ├─ seedPromiseSignals()
  ├─ validation du pipeline MemorySignal
  └─ graphe de recette Petro Atiti
```

Le module `seedPromiseSignals()` injecte quatre cas contrôlés :

| Cas | Donnée | Signal attendu |
|---|---|---|
| 1 | promesse datée échue et non confirmée | `PromiseExpired` |
| 2 | promesse ancienne sans date, non confirmée | `PromiseNeedsConfirmation` |
| 3 | promesse future | aucun signal |
| 4 | promesse confirmée | aucun signal |

La validation du reset logge systématiquement :

```text
records lus
candidats construits
PromiseExpired
PromiseNeedsConfirmation
signaux dashboard
```

Le résultat attendu est stable :

- 4 records lus ;
- 4 candidats ;
- 1 `PromiseExpired` ;
- 1 `PromiseNeedsConfirmation` ;
- 2 signaux finalement envoyés au dashboard.

## Le chantier de recette

`🧪 Recette` vit dans le tenant démo et porte `sites.is_sandbox = true` (mig 214).

Ce drapeau est le **droit d'être réinitialisé**, et il est porté par la base — pas par
le nom. Reconnaître un bac à sable à son libellé laisserait un chantier réel se faire
vider par un renommage ou un homonyme.

- `npx tsx scripts/dev/ensure-sandbox-site.ts` — crée le chantier (idempotent).
- `npx tsx scripts/dev/seed-sandbox-visit.ts` — y pose une visite débriefée.
- Bouton « Réinitialiser le chantier » (sur ce chantier seulement) — efface visites,
  actions, propositions et réserves. `resetSandboxSite` relit le drapeau en base :
  l'appelant ne peut pas le prétendre.

Les deux scripts **refusent** toute organisation autre que `demo`. Le garde-fou est
dans le code, pas dans une consigne : une consigne s'oublie à 2 h du matin.

## Reproduire un bug client

1. Cloner le chantier concerné dans le tenant démo.
2. Reproduire, corriger, valider **là**.
3. L'utilisateur constate le correctif sur ses vraies données.

Jamais l'inverse.

## Semer une visite : la matière, jamais le résultat

`seed-sandbox-visit.ts` écrit le **débrief dicté**, pas l'analyse. L'analyse est faite
par le vrai pipeline à l'ouverture du compte-rendu — elle coûte un appel LLM, et c'est
le prix d'une recette honnête. Semer une analyse toute faite validerait un chemin que
personne n'emprunte : la recette passerait au vert sans rien prouver.
