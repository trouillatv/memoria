# 12 — PL3 : le design AVANT le code

> Demandé le 2026-07-13 : « écris le design complet de `materializeOccurrence`,
> prouve son idempotence, montre qu'elle tient à J+21, propose le modèle de
> persistance de `keep`, et prouve que `occurrenceKey` ne peut pas collisionner. »
> **Aucune ligne de code PL3 n'a été écrite.** Tous les faits ci-dessous sont
> vérifiés — plusieurs le sont directement contre la base réelle.

## LA CONTRAINTE QUI PRIME SUR TOUT (Vincent, 2026-07-13)

> **La vue planning existante RESTE l'interface principale. Les lots ajoutent
> des données, des signaux et des gestes DANS cette vue ; ils ne la remplacent
> jamais.**

Ce que cela interdit, explicitement :

- ❌ créer une seconde vue planning qui concurrence `/semaine` ;
- ❌ remplacer `WeekGrid` ;
- ❌ supprimer le drag-and-drop ;
- ❌ reconstruire les cartes d'intervention ;
- ❌ déplacer les aperçus dans un nouveau module ;
- ❌ rendre la vue actuelle obsolète au profit d'une vue mois ;
- ❌ introduire un modèle d'intervention incompatible.

Relecture des lots à cette aune :

| Lot | Ce qu'il change à l'écran |
|---|---|
| **PL1** | **RIEN.** Il remplace le moteur INTERNE de calcul des occurrences. Même vue. |
| **PL2** | Une carte « Fermetures » sur la fiche chantier. **La vue planning est intacte.** |
| **PL3** | Un **badge** sur la carte existante quand elle tombe un jour fermé, et un **bloc conflit** dans l'aperçu existant. **Rien d'autre ne bouge.** |

Et le geste principal **reste le drag-and-drop** :

```
drag (14 → 15)
      ↓
matérialisation ciblée SI l'occurrence n'existe pas encore en base
      ↓
moveInterventionToDayAction  ← l'action EXISTANTE
      ↓
exactement la même interaction qu'aujourd'hui
```

Les cinq boutons de l'aperçu sont des **raccourcis**, pas le chemin obligé. Un
déplacement au drag **est** une résolution de conflit — l'utilisateur n'a pas à
passer par un formulaire différent.

**Règle technique qui découle de tout ça** : `materializeOccurrence` est une
**couche SOUS la vue**, jamais une nouvelle expérience. La vue planning ne doit
pas savoir si l'occurrence était projetée ou déjà matérialisée — elle manipule
un objet d'affichage **uniforme**, et la matérialisation se déclenche **au
moment du geste**, de façon invisible.

**Critères de non-régression, à tenir :**

- une intervention **sans** fermeture s'affiche et se déplace **exactement**
  comme aujourd'hui ;
- l'aperçu actuel reste **inchangé**, hors ajout d'un bloc conflit ;
- **aucun** nouveau calendrier ne remplace la vue existante ;
- les **tests actuels du drag-and-drop restent verts** (27/27 sur `week-grid`).

La future vue mois sera une vue **supplémentaire**, nourrie par le **même**
moteur :

```
Moteur unique (PL1 × PL2)
├── vue semaine existante   ← l'interface principale, conservée
├── future vue mois         ← une vue de plus, jamais un remplacement
└── alertes du tableau de bord
```

## 0. Deux découvertes qui changent le design

### a) Je m'étais alarmé à tort sur `occurrenceKey`

Mon rapport PL1 disait : « 06:00 et 09:00 tombent tous deux sur `morning` → une
seule identité ». **C'est faux, et je le corrige.**

La clé est `template_id | scheduled_for | slot`. Deux prestations à 06:00 et
09:00 le même matin viennent forcément de **deux templates différents** (un
template n'a qu'UNE colonne `planned_start_hhmm`, mig 021:40) — donc **deux
`template_id`, donc deux clés distinctes**. Aucune collision.

Un template ne peut produire deux occurrences le même jour dans le même créneau
que dans **un seul cas dégénéré** : des créneaux **en double** dans le tableau
`slots` (`['morning','morning']`). Le CHECK de la mig 021:46-47 ne l'interdit
pas (`<@` teste l'inclusion, **pas l'unicité**). Vérifié en base : **0 template
dans ce cas** aujourd'hui.

→ **L'option A (« un template ne produit qu'une occurrence par créneau ») est
déjà vraie par construction.** Il suffit de la rendre inviolable : **dédupliquer
les créneaux dans `effectiveSlots`** (`lib/planning/projection.ts`) — pur, sans
migration. C'est une invariante à graver, pas une refonte de clé.

### b) Le vrai trou : l'index unique NE protège PAS quand `slot` est NULL

Vérifié **contre la base réelle** (PostgreSQL 17.6) :

```
CREATE UNIQUE INDEX idx_interventions_template_unique
  ON public.interventions (template_id, scheduled_for, slot)
  WHERE (template_id IS NOT NULL)
        -- ⚠ pas de NULLS NOT DISTINCT
```

Postgres traite les NULL comme **distincts** par défaut : deux lignes
`(template, date, NULL)` seraient **toutes deux acceptées**. Or `slot` EST null
pour un template sans heure et sans créneau (`effectiveSlots` renvoie `[null]`).

**Conséquence** : le filet anti-course de la matérialisation **ne tient pas**
dans ce cas — deux clics simultanés créeraient deux interventions. Aujourd'hui
la génération s'en tire par un pré-filtrage applicatif (un `Set`), qui ne
protège d'aucune course réelle.

→ **Migration 198 (additive)** : recréer l'index en `NULLS NOT DISTINCT` (supporté
depuis PG 15 ; nous sommes en 17). Elle bénéficie aussi à la génération
existante. Vérifié : **0 collision réelle en base** aujourd'hui — la migration
passera sans conflit.

---

## 1. `materializeOccurrence` — le design

```ts
// lib/planning/materialize.ts  (server-only)
export async function materializeOccurrence(input: {
  templateId: string
  scheduledFor: string              // yyyy-mm-dd
  slot: InterventionSlot | null
}): Promise<
  | { ok: true; interventionId: string; created: boolean }
  | { ok: false; error: string }
>
```

**Une seule porte.** Tout geste qui a besoin d'un `intervention.id` passe par
elle — PL3, mais aussi, demain : déposer une preuve, démarrer, faire un
compte-rendu sur une occurrence encore virtuelle.

Les cinq étapes :

1. **Charger le template** (actif, non supprimé) → `mission_id`, heures, créneaux.
2. **Vérifier que l'occurrence EXISTE dans le rythme** : on rejoue
   `projectOccurrences({ templates: [tpl], from: date, to: date })` (le moteur
   PL1, pas une copie) et on exige que le `slot` demandé y figure.
   **C'est la garde anti-forgerie** : on ne matérialise pas une date/créneau
   inventés par un client malveillant. *Le même moteur décide de l'affichage et
   de l'écriture — jamais deux vérités.*
3. **Chercher l'existant** par `(template_id, scheduled_for, slot)` →
   si trouvé : `{ created: false }`. **Rien n'est écrit.**
4. **Sinon insérer**, en héritant **de la mission** (jamais de la session) :
   `mission_id`, `default_team`, `assigned_team_id`, `organization_id`
   (fail-closed : mission sans organisation → refus, pas d'intervention
   orpheline). `status = 'planned'`. Les `planned_start` / `planned_end`
   viennent **de l'occurrence projetée**, pas d'un recalcul local.
5. **Absorber la course** : sur violation d'unicité (`23505`), on **re-SELECT**
   et on renvoie la ligne gagnante. Deux clics simultanés → **une seule**
   intervention, deux réponses identiques.

> La logique d'héritage existe déjà (`intervention-templates.ts:326-343` et
> `368-388`). Elle sera **extraite**, pas recopiée : sinon deux vérités.

### 2. Pourquoi c'est idempotent

`materializeOccurrence` est une **fonction du seul triplet** `(template, date,
slot)` — qui est **exactement** l'index unique de la base. Deux appels
identiques renvoient le **même** `interventionId` ; le second n'écrit rien
(`created: false`). Appelée mille fois, elle crée au plus **une** ligne.

L'idempotence ne repose donc pas sur la prudence de l'appelant, mais sur une
**contrainte de base de données** — à condition que la migration 198 ferme le
trou des NULL (§0.b). **Sans 198, l'idempotence est fausse dans le cas
`slot = NULL`.** C'est le prérequis n°1 de PL3.

### 3. Pourquoi il n'y a pas de double insertion

Trois couches, dans cet ordre :

| Couche | Ce qu'elle attrape |
|---|---|
| SELECT préalable | Le cas normal (l'occurrence est déjà matérialisée) |
| Index unique partiel **+ NULLS NOT DISTINCT** (mig 198) | La **course** — deux transactions concurrentes |
| `catch 23505 → re-SELECT` | Le perdant de la course, qui repart avec la bonne ligne |

Pas besoin de transaction explicite : l'opération d'écriture est **un seul
INSERT**, atomique par nature. (Variante plus stricte, écartée pour ne pas
introduire une convention nouvelle : une fonction SQL `ON CONFLICT DO NOTHING
RETURNING id` en un aller-retour. `supabase-js` ne sait pas cibler un index
**partiel** en `upsert` — c'est déjà documenté dans
`intervention-templates.ts:395-401`.)

### 4. Pourquoi ça marche à J+21

Le cap de 7 jours vit dans `generateInterventionsFromTemplates`
(`intervention-templates.ts:263-268`, un `throw`). Il existe pour empêcher la
**pré-matérialisation de masse** — pas pour interdire une écriture ponctuelle.

`materializeOccurrence` est une **autre fonction** : elle matérialise **UNE**
occurrence, **parce qu'un humain a posé un geste**. C'est littéralement la
doctrine que tu as posée :

> « Une occurrence ne devient persistante que lorsqu'elle est modifiée,
> déplacée, annulée, maintenue malgré une fermeture, démarrée, réalisée ou
> associée à une preuve. »

Elle **ne touche pas au cap** et ne le contourne pas : elle vit à côté. La
génération glissante reste plafonnée ; un conflit à J+21 devient actionnable.
**Aucune ligne n'est écrite tant que personne ne clique.**

---

## 5. Le modèle de persistance de « maintenir »

`keep` n'est ni `planned`, ni `skipped`, ni `completed`. **Ce n'est pas un
statut : c'est une DÉCISION prise face à un conflit.** On ne touche donc pas à
l'enum `intervention_status` (mig 018:34) — on ajoute une **exception datée**.

```sql
-- 199 — closure_override : ce que l'humain a décidé face à une fermeture.
create table if not exists public.closure_override (
  id              uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  closure_id      uuid not null references public.site_closures(id) on delete cascade,
  decision        text not null check (decision in ('keep', 'move', 'cancel')),
  reason          text check (reason is null or length(reason) <= 500),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz          -- « je me suis trompé » → on RETIRE la décision
);

-- Une seule décision ACTIVE par (intervention, fermeture).
create unique index if not exists closure_override_unique
  on public.closure_override (intervention_id, closure_id)
  where deleted_at is null;
```

**Ce que chaque geste écrit vraiment :**

| Geste | Écriture | Réutilise |
|---|---|---|
| **Maintenir** | matérialise l'occurrence + `closure_override(decision='keep')` | — |
| **Déplacer** (avant / après / autre date) | matérialise + `moveInterventionToDayAction` + `closure_override(decision='move')` | l'action **existante** (garde org, conflit d'équipe, refus de date passée, journal d'audit) |
| **Annuler** | matérialise + `markInterventionSkipped(reason = « Site fermé — {motif} »)` + `closure_override(decision='cancel')` | l'action **existante** |
| **Décider plus tard** | **RIEN** | le conflit reste ouvert (c'est le comportement, pas un oubli) |

**Le conflit reste CALCULÉ, jamais stocké** — conforme à la doctrine
(`signals/types.ts:5-8`, `week-operational-signals.ts:20-24`) :

```
conflit = occurrence projetée (PL1)
        ∧ fermeture applicable (PL2)
        ∧ AUCUNE décision active (closure_override)
```

Seul **le geste** s'écrit. C'est ce qui fait disparaître l'alerte — pas un
statut « lu ».

### Et `cancelled` ?

Il **n'existe pas** dans l'enum (vérifié : mig 018:34 —
`planned|in_progress|completed|validated|skipped`, aucun `ALTER TYPE`).

**Recommandation : ne pas l'ajouter.** « Annuler pour cause de fermeture » et
« on n'est pas passés » (`skipped`) diffèrent par le **pourquoi**, pas par
l'état de l'intervention. Le pourquoi est déjà porté par `skipped_reason` **et**
par la ligne `closure_override(decision='cancel')`, qui pointe la fermeture
exacte. Ajouter un statut coûterait une migration d'enum et une mise à jour de
**toutes** les vues qui filtrent par statut — pour une information qu'on stocke
déjà mieux ailleurs.

*C'est une recommandation, pas une décision : elle t'appartient.*

---

## 6. Preuve : `occurrenceKey` ne peut pas collisionner

| Cas | Même clé ? | Pourquoi |
|---|---|---|
| Deux templates, même jour, même créneau (06:00 et 09:00 → `morning`) | **Non** | `template_id` est **dans** la clé → deux clés distinctes. Les deux prestations existent, et c'est correct. |
| Un template à heure précise, un jour | **Impossible d'en avoir deux** | Une seule colonne `planned_start_hhmm` (mig 021:40) → exactement **une** occurrence/jour. |
| Un template à créneaux legacy `['morning','evening']` | **Non** | Créneaux distincts → clés distinctes. |
| Un template à créneaux **en double** `['morning','morning']` | **OUI — le seul cas** | Le CHECK `slots <@ array[…]` (021:46) teste l'inclusion, **pas l'unicité**. |
| Un template sans heure ni créneau (`slot = NULL`) | **Clé identique, mais l'index NE PROTÈGE PAS** | `NULLS DISTINCT` par défaut (§0.b) — **le vrai danger**. |

**Deux verrous à poser avant PL3b :**

1. **dédupliquer les créneaux** dans `effectiveSlots` (pur, sans migration) —
   ferme le cas dégénéré ;
2. **migration 198** : index en `NULLS NOT DISTINCT` — ferme le cas `slot=NULL`,
   et rend l'idempotence **vraie** au niveau base.

Vérifié en base réelle : **0 template à créneaux en double, 0 collision
existante**. Les deux verrous se posent donc sans rien casser.

---

## Ordre d'exécution proposé

| Lot | Contenu | Migration ? |
|---|---|---|
| **PL3-0** | Les deux verrous (dédup créneaux + mig 198 `NULLS NOT DISTINCT`) + `materializeOccurrence` + ses tests d'idempotence et de course | **198** (additive) |
| **PL3a** | **Détection seule** : le conflit s'affiche (« Discount Pointière · 14 juillet · site fermé, intervention prévue »). **Aucun bouton.** | aucune |
| **PL3b** | Les gestes : maintenir / déplacer / annuler / autre date / décider plus tard | **199** (`closure_override`) |

PL3-0 est invisible pour l'utilisateur — mais sans lui, **PL3b poserait des
boutons sur du sable** : l'idempotence serait fausse dès qu'un template n'a ni
heure ni créneau.

**Aucune ligne de code PL3 n'a été écrite. Ce document attend ta validation.**
