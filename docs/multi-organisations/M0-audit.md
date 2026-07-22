# M0 — Audit factuel multi-organisations

**Date** : 2026-07-22 · **Statut** : audit seul, aucun comportement modifié.

Objectif : établir l'état réel du dépôt avant toute décision. Chaque affirmation
cite le fichier, la migration ou la mesure en base qui la fonde.

---

## Le verdict en trois phrases

1. **Un utilisateur ne peut appartenir qu'à une organisation, structurellement** :
   `users.organization_id` est une colonne scalaire. Il n'existe aucune table de
   liaison.
2. **Le cloisonnement ne repose PAS sur la RLS** mais sur 193 filtres écrits à la
   main dans le code, parce que le service-role contourne la RLS.
3. **Le modèle d'appartenance des objets est hybride** : `site_deadlines` porte
   `organization_id`, `site_actions` non. Deux objets du même niveau, deux
   régimes de sécurité.

Le point 3 est le vrai chantier. Les points 1 et 2 sont mécaniques.

---

## 1. Modèle Auth actuel

`public.users` — migration `002_users.sql:3`

```
id                   uuid PK → auth.users(id) ON DELETE CASCADE
email                text not null
full_name            text
role                 user_role not null default 'chef_equipe'
must_change_password boolean
deleted_at           timestamptz
```

- **Une seule ligne par humain**, adossée à `auth.users`. Conforme à la cible.
- **Il n'existe pas de table `user_profiles`** : le profil personnel vit dans
  `public.users`. La cible du prompt les sépare ; l'existant les fusionne. Ce
  n'est pas bloquant — `users` joue déjà le rôle de profil.

## 2. Modèle des organisations

`public.organizations` — migration `089_organizations.sql:16`

```
id, name, slug (unique), created_at
```

Aucune colonne province, agence ou entité juridique.

**En base (mesuré)** : 5 organisations — AGP, ContraBat, BatiSud Construction,
Becib, Démo MemorIA. **SERVINOR n'existe pas.**

## 3. Relation utilisateur ↔ organisation

`089_organizations.sql:26`

```sql
alter table public.users add column if not exists organization_id
  uuid references public.organizations(id);
```

**Relation 1→N** (une org a N users). Un utilisateur pointe **une** organisation.

## 4. Appartenance multiple possible aujourd'hui ?

**Non — structurellement impossible.** Il faudrait une table de liaison ; elle
n'existe pas.

Faux positif écarté : `team_members` (`023_teams_and_assignment.sql`) est
l'appartenance à une **équipe de chantier**, sans rapport avec l'organisation.

## 5. Le rôle est porté par l'utilisateur, pas par l'appartenance

`users.role` (enum `user_role`, mig 002). **Un rôle global**, donc aujourd'hui
impossible d'être administrateur AGP et lecteur SERVINOR.

**En base** : 10 `manager`, 9 `chef_equipe`, 2 `admin`.

⚠️ `admin` n'est pas un rôle tenant : c'est le **super-admin plateforme**, l'une
des deux seules exceptions documentées à l'isolation (`lib/db/users.ts:41-51`).
Il ne doit **jamais** devenir un rôle d'appartenance.

## 6. Tables portant `organization_id`

**32 tables** recensées par `089_organizations.sql`, plus des ajouts ultérieurs.

Vérifié directement en base (colonnes réelles, pas les migrations) :

| Table | `organization_id` |
|---|---|
| `site_reports` | ✅ |
| `site_deadlines` | ✅ |
| `site_knowledge_proposals` | ✅ |
| `visit_capture` | ✅ |
| `report_documents` | ✅ |
| `companies` / `company_contacts` | ✅ |
| **`site_actions`** | ❌ |
| **`site_decisions`** | ❌ |
| **`site_intervenants`** | ❌ |
| **`site_action_events`** | ❌ |

## 7. Tables héritant de l'organisation par le chantier

Celles marquées ❌ ci-dessus n'ont **que** `site_id`. Tout contrôle d'isolation
passe donc par une jointure vers `sites.organization_id`.

**C'est le défaut central de l'existant** : le prompt demande d'éviter « les
chaînes de jointures fragiles pour les contrôles de sécurité ». Elles sont déjà
là, et de façon incohérente — une échéance porte son organisation, l'action qui
la précède non.

## 8. Requêtes supposant une seule organisation

`getOrgId()` — `lib/db/users.ts:32` :

```ts
const user = await getCurrentUserWithProfile()
return user?.organization_id ?? null   // scalaire
```

**193 appels** dans `app/`, `lib/`, `services/`. Chacun enchaîne typiquement
`.eq('organization_id', orgId)`.

C'est le rayon d'impact réel du lot. **Ce n'est pas la table de liaison qui
coûte cher, c'est cette signature scalaire.**

## 9. Pages utilisant une « organisation active » en session

**Aucune.** Recherche `active_organization|currentOrg|switchOrg|org_switch` :
seuls résultats, les formulaires de la console admin qui **déplacent** un
utilisateur d'une org à l'autre (`app/admin/organisations/OrgForms.tsx`,
`app/admin/personnes/PersonnesTable.tsx`).

**Bonne nouvelle** : il n'y a aucune mauvaise abstraction à défaire, et aucun
état de session à démêler. Le terrain est vierge.

## 10. RLS supposant une seule organisation

`public.current_user_org_id()` — `089_organizations.sql:32`

```sql
select organization_id from public.users where id = auth.uid() limit 1
```

**Scalaire.** C'est le socle de toute politique qui s'en sert.

**Mais** : 157 politiques RLS au total, dont **~9 seulement** filtrent sur
`organization_id`.

⚠️ **La RLS n'est pas le cloisonnement principal.** Le code applique
`createAdminClient()` (service-role), qui **contourne la RLS** — d'où les **62
gardes explicites** de la forme `organization_id !== orgId` écrites à la main
dans les server actions et les pages. Le commentaire canonique du dépôt le dit
partout : *« Isolation tenant : le service-role passe outre la RLS, le filtre
est ICI. »*

**Conséquence pour le lot** : renforcer la RLS ne suffira pas. Le vrai
cloisonnement est applicatif, donc l'audit de sécurité (M8) doit porter sur les
62 gardes et les 193 appels, pas seulement sur les politiques SQL.

## 11. Risques de fuite inter-organisations

| Surface | État | Risque |
|---|---|---|
| `search.ts` | `.eq('organization_id', orgId)` ×4 | Faible |
| `memory-search.ts` | scope explicite + commentaire d'incident | Faible |
| `site_actions`, `site_decisions`, `site_intervenants` | pas d'`organization_id` | **Élevé** — un appelant qui oublie la jointure fuit |
| **`notifications`** | **aucun scope organisation** (`lib/db/notifications.ts`, scope `user_id`) | **Élevé demain** |
| URLs signées | **15** `createSignedUrl` non audités individuellement | À vérifier (M8) |

⚠️ **Notifications** : aujourd'hui inoffensif (1 user = 1 org, donc l'org est
implicite). Demain, une notification ne saura **pas** dire de quelle
organisation elle parle — exactement l'ambiguïté que le prompt interdit.

## 12. Données à migrer

Mesuré en base :

- **21 utilisateurs**, dont **1 sans organisation** (à traiter explicitement)
- **28 chantiers**, dont **0 sans `organization_id`** ✅
- **5 organisations**

La migration d'appartenance est donc triviale : 20 lignes à créer.

## 13. Compatibilité mono-organisation

**Totale.** Tous les utilisateurs sont mono-org par construction. Une table de
liaison peuplée depuis `users.organization_id` reproduit **exactement** l'état
actuel. Aucun utilisateur ne voit d'étape nouvelle tant qu'il n'a qu'une
appartenance.

## 14-17. Impacts

- **Desktop** : `/sites` (déjà groupée par client), tableau de bord, actions,
  planning. Aucun sélecteur d'organisation à retirer — il n'y en a pas.
- **Mobile** (`app/(field)/m/`) : même moteur, mêmes `getOrgId()`. Pas de
  notion d'org à l'écran aujourd'hui.
- **PDF / fichiers privés** : 15 `createSignedUrl`. Le PDF de visite lit
  `buildVisitCrDoc`, qui part du `report_id` — l'org vient du rapport.
- **AO / missions / planning** : `tenders`, `missions`, `interventions` portent
  `organization_id` ✅. `notifications` non ❌.

---

## Question produit non tranchable par le code

**AGP et SERVINOR : deux organisations, ou deux agences d'une même entité ?**

Le dépôt ne peut pas répondre — SERVINOR n'existe pas encore. La réponse change
le modèle :

- **deux organisations** → appartenances multiples, cloisonnement strict,
  référentiels séparés (clients, sociétés, modèles) ;
- **deux agences** → une organisation, une dimension `agency` sur les chantiers,
  cloisonnement *souple*, référentiels **partagés**.

Le prompt dit « n'ajoute pas immédiatement un modèle agency si l'existant ne le
justifie pas ». L'existant ne le justifie pas. Mais si Guillaume voit les mêmes
clients et les mêmes sociétés des deux côtés, c'est le modèle agence qu'il
faut — et le lot est bien plus petit.

**Cette question doit être tranchée avant M1.**

---

## Plan de réalisation proposé

### La bascule qui décide de tout

Ne **pas** transformer `getOrgId()` en `getOrgIds()` : cela impacterait les 193
appels d'un coup, dont la moitié sont des **écritures** qui ont besoin d'**une**
organisation, pas d'une liste.

Séparer les deux besoins :

| Besoin | Fonction | Sémantique |
|---|---|---|
| Écrire | `getOrgId()` — inchangée | L'org du chantier concerné |
| Lire en agrégé | `getOrgIdsOfUser()` — nouvelle | Les orgs accessibles |

Ainsi M1 et M3 ne touchent **aucun** des 193 appels existants.

### Lots

| Lot | Contenu | Risque |
|---|---|---|
| **M0** | Cet audit. Aucun changement. | — |
| **M1** | Table `organization_memberships` (user, org, rôle, statut), peuplée depuis `users.organization_id`. `users.organization_id` **conservée** comme org par défaut. Tests d'isolation. | Faible — additif |
| **M2** | Combler le modèle hybride : `organization_id` sur `site_actions`, `site_decisions`, `site_intervenants`, `site_action_events`, avec trigger d'héritage depuis le chantier (le motif existe déjà : `set_intervention_child_org`, mig 114). | **Moyen** — migration de données |
| **M3** | Lectures agrégées via `getOrgIdsOfUser()` + badges d'organisation. Aucune écriture modifiée. | Faible |
| **M4** | Filtre facultatif Toutes/AGP/SERVINOR. Lecture seule, jamais une autorisation. | Faible |
| **M5** | Écritures héritant de l'org du chantier ; suppression des sélecteurs. | Moyen |
| **M6** | Administration par organisation ; rôle lu depuis le membership. | Moyen |
| **M7** | Mobile. | Faible |
| **M8** | Sécurité : 62 gardes, 193 appels, 15 URLs signées, RLS, recherche, PDF. | **Élevé** |

**M2 avant M3**, contrairement à l'ordre du prompt : agréger des lectures
au-dessus d'un modèle où quatre tables n'ont pas d'organisation reviendrait à
bâtir la vue multi-org sur la partie non cloisonnée.

### Ce que ce plan ne fait pas

- Aucun second compte Auth.
- Aucun profil dupliqué.
- Aucune organisation active en session (rien à retirer, il n'y en a pas).
- Aucune migration de masse avant que la question AGP/SERVINOR soit tranchée.
