# Lot 2B.3 — Fiches Personne / Entreprise / Équipe · cadrage & audit

> Cadrage AVANT tout code (discipline Vincent 2026-07-27). Fondé sur l'audit du
> code réel (schéma + read models existants). Priorité **fiche Personne**.
> Le graphe (2B.4) reste reporté. Doctrine : [[architecture-trois-surfaces]],
> surface = cockpit des acteurs (cf. cadrage 2B.2).

## 0. Mission d'une fiche
Quand j'ouvre un acteur : **qu'ai-je besoin de comprendre, et où dois-je aller ensuite ?**
Une fiche **résume la situation actuelle**, montre les **rattachements**, liste les
**sujets à traiter**, puis **lie vers les surfaces propriétaires** — elle ne recopie
jamais leur contenu complet. Risque n°1 = **sur-agrégation** (fiche géante). Règle
stricte : *situation actuelle d'abord, historique limité, détail délégué par lien*.

---

## 1. Contrat de l'état d'attention (politique commune, pure, testable)

Le pivot du lot. **Une seule** politique, consommée par la ligne du cockpit ET par
chaque fiche → un acteur ne peut jamais être vert dans la liste et rouge dans sa fiche.

### 1.1 Nommage (décision Vincent)
- Code / métier : **`attentionState`** (pas « santé » — ne juge pas l'acteur).
- Fonction pure proposée : `deriveActorAttentionState(facts): AttentionState`
  (à placer dans `lib/knowledge/actor-attention.ts`).
- Niveaux : `ok | attention | urgent`.
- Libellés UI : **À jour · À surveiller · À traiter** (jamais « bonne/mauvaise santé »).
- Couleurs : 🟢 vert · 🟠 ambre · 🔴 rouge — décrivent la **situation opérationnelle
  visible dans MemorIA**, jamais la performance de l'acteur.

### 1.2 Forme de retour
```ts
type AttentionLevel = 'ok' | 'attention' | 'urgent'
interface AttentionReason { code: string; count: number; label: string }
interface AttentionState { level: AttentionLevel; reasons: AttentionReason[] }
```
**Doctrine (à écrire en tête du module) :** « L'état d'attention d'un acteur décrit
les faits opérationnels qui lui sont actuellement associés. Il n'évalue ni sa qualité,
ni sa performance, ni sa fiabilité générale. » Chaque état est **toujours** accompagné
de ses raisons ; jamais « 🔴 » seul. `level` = max des sévérités des `reasons`.

### 1.3 Règles par type (déterministes, alignées sur les alertes du cockpit)
Les `code` réutilisent les alertes déjà calculées dans `actors-cockpit.ts` — la fiche
enrichit seulement le `count` et le `label`.

**Personne**
| level | condition | code |
|---|---|---|
| urgent | ≥ 1 action ouverte en retard dont elle est référent | `overdue_actions` |
| attention | agent interne sans équipe active | `agent_no_team` |
| attention | responsable d'action ouverte mais plus mobilisée sur le chantier | `responsible_not_active` |
| attention | fiche incomplète **seulement si** cela empêche réellement un usage (à figer, cf. §1.4) | `incomplete_profile` |
| ok | aucune alerte déterministe | — |

**Entreprise**
| level | condition | code |
|---|---|---|
| urgent | ≥ 1 action ouverte en retard | `overdue_actions` |
| attention | action ouverte sans contact référent | `company_no_referent` |
| attention | responsable d'action mais sortie du casting actif | `company_left_casting` |
| attention | placeholder / identité à compléter (si l'entité est affichée) | `identity_incomplete` |
| ok | aucune alerte | — |

**Équipe** — *prudence assumée : pas d'`urgent` fondé sur la somme des retards des
membres* (l'équipe n'est pas structurellement responsable des actions, cf. §5.3).
| level | condition | code |
|---|---|---|
| attention | équipe active sans personne terrain | `team_no_field_member` |
| attention | équipe affectée à un chantier mais vide | `team_empty_but_assigned` |
| attention | membre portant encore des actions sur un chantier dont l'équipe est sortie | `member_orphan_actions` |
| ok | aucune alerte | — |

### 1.4 Points à trancher dans le contrat (avant 2B.3A)
1. **`incomplete_profile` (personne)** : quelle condition exacte « empêche un usage » ?
   Proposition : agent interne sans équipe **et** sans casting **et** sans e-mail/tel
   → sinon on n'affiche pas d'attention pour incomplétude. À valider.
2. **`responsible_not_active` vs `overdue`** : si une personne a une action **en retard**
   sur un chantier dont elle est sortie, priorité `urgent` (retard) ou `attention`
   (plus mobilisée) ? Proposition : le retard prime → `urgent` + raison additionnelle.
3. **Retrofit cockpit** : la ligne du cockpit (2B.2) affiche aujourd'hui `alerts[]`.
   En 2B.3A elle consommera `deriveActorAttentionState` pour afficher le **même**
   badge (🟢/🟠/🔴 + 1ʳᵉ raison). Confirmer qu'on accepte ce léger retrofit de la vue
   existante (sans changer les données).

---

## 2. Inventaire des données — FICHE PERSONNE
Sujet = **`company_contacts`** (contact terrain/externe). ⚠️ distinct du **compte**
`users` dont la fiche existe déjà à `/intervenants/[userId]`.

Légende : ✅ fiable (FK/requête déterministe) · ⚠️ approximatif · ❌ impossible.

| Donnée | Source | Classe |
|---|---|---|
| Identité (full_name, function) | `company_contacts` (mig 137) | ✅ |
| Catégorie (agent interne / contact externe) | `is_internal_agent` (mig 244), `company_id` | ✅ |
| Coordonnées (email, phone, mobile) | `company_contacts` (mig 137) | ✅ |
| Entreprise de rattachement | `company_id → companies` (mig 219 : nullable) | ✅ |
| Statut actif / incomplet / historique | dérivé (casting/équipe/actions) — cf. `actors-cockpit.ts` | ✅ |
| Équipes actives / historiques | `team_field_members` (contact_id, `left_at`, mig 219) | ✅ |
| Chantiers au casting (rôle) actif / historique | `site_intervenants` (main_contact_id, role, `effective_to`, mig 137/138) | ✅ |
| Actions où référent (ouvertes / en retard) | `site_actions.assigned_contact_id` + `due_date`/`status` (mig 220) | ✅ |
| Actions où **son entreprise** est responsable | `site_actions.assigned_company_id = company_id` (mig 245) | ✅ |
| Décisions où décisionnaire | `site_decisions.decisionnaire_contact_id` (mig 138) | ✅ |
| Rapprochement compte possible | heuristique e-mail exact / nom normalisé (`actors-cockpit.ts:~125`) | ✅ (signal) |
| Origine de création (provenance) | `site_knowledge_proposals` kind='stakeholder', `source_report_id`/`source_capture_ids`, `promoted_object_id` (mig 212/232) | ⚠️ (parsing payload JSONB, pas FK directe vers le contact) |
| Visites/réunions où **citée** | `site_reports.participants` JSONB (rapprochement par nom) | ⚠️ (JSONB libre, pas de FK → « Citée », jamais « Confirmée ») |
| Lien structurel vers un compte `users` | — | ❌ aucune FK ; jamais de fusion |
| « Dernière activité » précise (log par personne) | — | ❌ (au mieux : date de la dernière action/visite — à omettre ou marquer approx.) |

---

## 3. Inventaire des données — FICHE ENTREPRISE
Sujet = **`companies`** (hors placeholder « À identifier », hors archivée pour l'entrée).

| Donnée | Source | Classe |
|---|---|---|
| Identité (name, short_name) | `companies` (mig 137) | ✅ |
| Coordonnées (SIRET, adresse, phone, email, website, logo, notes) | `companies` (mig 137) | ✅ |
| Statut actif / placeholder / archivé | `is_placeholder` (mig 232), `deleted_at`, présence casting actif | ✅ |
| Chantiers actifs / historiques + rôles | `site_intervenants` par `company_id` (`effective_to`, `role`) | ✅ |
| Métier / corps d'état | **déduit** de `site_intervenants.role` (pas une colonne `companies`) | ⚠️ (liste de rôles, pas une identité unique) |
| Contacts rattachés | `company_contacts.company_id` | ✅ |
| Contact principal par chantier | `site_intervenants.main_contact_id` | ✅ |
| Actions ouvertes / en retard | `site_actions.assigned_company_id` + `due_date`/`status` (mig 245) | ✅ |
| Actions sans contact référent | `assigned_company_id` set ET `assigned_contact_id` null | ✅ |
| Responsable mais sortie du casting | actions ouvertes vs absence de casting actif | ✅ |
| Origine / propositions non confirmées | `site_knowledge_proposals` (payload JSONB) | ⚠️ (parsing, pas FK) |
| Visites où citée | `site_reports.participants` JSONB | ⚠️ |

---

## 4. Inventaire des données — FICHE ÉQUIPE
Sujet = **`teams`**. Fiche déjà **largement existante** (`/equipes/[id]` + `team-profile.ts`).

| Donnée | Source | Classe |
|---|---|---|
| Identité (name, color, icon, specialties, active) | `teams` (mig 023/077/078) | ✅ |
| **organization_id** (isolation) | `teams.organization_id` (mig 089, **NOT NULL depuis 237**) | ✅ **corrige une note de mémoire erronée** |
| Référent | `teams.referent_user_id` (mig 025), UI `TeamReferentEditor` | ✅ |
| Membres connectés actifs / historiques | `team_members` (user_id, `left_at`, mig 023) | ✅ |
| Agents terrain actifs / historiques | `team_field_members` (contact_id, `left_at`, mig 219) | ✅ |
| Mobilisation (chantiers/missions) | `missions.assigned_team_id` + `interventions.assigned_team_id` (mig 023) | ✅ |
| Créneaux / dates d'intervention | `interventions.scheduled_for` / `planned_start`/`end` | ✅ (pas de « période d'affectation » distincte) |
| **Actions portées par l'équipe** | ❌ **aucune** `site_actions.assigned_team_id`. Seulement actions des **membres** (contact ∈ agents terrain) | ⚠️ à formuler prudemment (cf. §5.3) |

---

## 5. Différences assumées entre les trois fiches
Structure visuelle **commune** (§6), mais **contrats métier distincts** — jamais
identiques artificiellement.

### 5.1 Personne — « Qui est-elle, où intervient-elle, qu'attend-on d'elle ? »
Sections : Identité (+ badge « Compte lié possible ») · Situation opérationnelle
(attentionState + actions référent + actions via son entreprise + historiques) ·
Organisation (équipes, casting, entreprise) · Historique utile (visites citées ⚠️,
décisions, provenance) · Navigation.

### 5.2 Entreprise — « Où intervient-elle, qu'attend-on d'elle ? »
Sections : Identité (statut actif/placeholder/archivé) · Situation opérationnelle
(attentionState + actions ouvertes/retard/sans référent + historiques) · Présence
chantier (chantiers actifs/historiques + rôles) · Contacts (rattachés, principal par
chantier, référents d'actions) · Navigation.

### 5.3 Équipe — « Qui la compose, où mobilisée, quels sujets ses membres portent-ils ? »
Sections : Identité (référent) · Composition (membres connectés + agents terrain +
historiques) · Mobilisation (chantiers/missions) · **Travail porté** — formulation
imposée : « **Actions portées par les membres de cette équipe sur les chantiers où
elle est mobilisée** ». Ne JAMAIS laisser croire que l'équipe est structurellement
responsable (le lien n'existe pas). Alertes §1.3.

---

## 6. Hiérarchie visuelle commune (3 fiches)
1. **En-tête** : icône type (person/company/team) + nom + badges (statut, catégorie,
   **attentionState** avec sa 1ʳᵉ raison).
2. **Situation actuelle d'abord** : bloc « À traiter » = actions ouvertes / en retard /
   sans référent, avec **liens** vers les objets (pas de copie du gestionnaire d'actions).
3. **Rattachements** : organisation / présence chantier / composition selon le type.
4. **Historique limité** : replié ou tronqué, avec « voir plus » vers la surface propriétaire.
5. **Navigation** : liens sortants systématiques.
Composants réutilisables (audit) : `Card`, `Badge`, `StatusBadge`, `TeamBadge`,
`EmptyState`, patterns « Stat » inline, grilles 2 colonnes. Rythme/heatmap/galerie
existants (`IntervenantRhythm`, `TeamRhythm`, `IntervenantPhotoGallery`) réutilisables
mais **optionnels** (risque de sur-agrégation — n'ajouter que si utile à la décision).

---

## 7. Réutilisation des read models existants
| Existant | Verdict | Usage 2B.3 |
|---|---|---|
| `getSiteIntervenantFiche` (`lib/knowledge/site-intervenants-view.ts:394`) + `IntervenantPerson` (l.38) + `buildIntervenantPeople` (l.125) | ⚠️ à adapter | **site-scopé** (casting actif d'un chantier). La fiche Personne est **org-globale** (toutes interventions/chantiers). Créer `getPersonFiche(contactId, orgIds)` en s'inspirant de la structure, sans réutiliser la version site-scopée telle quelle. |
| `team-profile.ts` (`getTeamOverview` l.225 + companions) | ✅ réutilisable | Base directe de la fiche Équipe 2B.3C ; ajouter l'`attentionState` + le bloc « travail porté par les membres ». |
| `/intervenants/[id]/page.tsx` (fiche **compte** user) | ✅ base/pattern | Garde-fous (accès + audit log), en-tête, Stat, galerie. ⚠️ c'est la fiche COMPTE, pas la fiche contact-personne. |
| `/equipes/[id]/page.tsx` | ✅ réutilisable | Déjà la fiche équipe + garde tenant fail-closed. |
| `actors-cockpit.ts` (calculs d'alertes) | ✅ source des `code` | La politique `deriveActorAttentionState` factorise ces règles ; le cockpit s'y branche (retrofit §1.4-3). |

---

## 8. Routes & liens
### Routes à créer / réutiliser
- **Personne (contact)** : route NEUVE. Proposition `/intervenants/personne/[contactId]`
  (segment statique `personne` → pas de collision avec `/intervenants/[userId]` = compte). *À valider.*
- **Entreprise** : route NEUVE. Proposition `/intervenants/entreprise/[companyId]`. *À valider.*
- **Équipe** : **réutiliser** `/equipes/[teamId]` (le cockpit y lie déjà). 2B.3C = enrichir, pas créer.

### Liens sortants (vers les surfaces propriétaires — jamais recopier)
- Action → `/sites/[siteId]/action/[actionId]` (ActionFiche + provenance).
- Chantier → `/sites/[siteId]`. Équipe → `/equipes/[teamId]`.
- Compte lié possible → `/intervenants/[userId]` (signal, pas fusion).
- Réunion/visite source → route du rapport. ⚠️ **caveat mobile/desktop** : les CR de
  visite sont mobiles (`/m/visite/[reportId]`), la provenance riche est desktop — un
  lien depuis une fiche desktop reste desktop (cohérent).

---

## 9. Permissions & isolation d'organisation
- Pattern dominant confirmé : `createAdminClient()` (service-role) + **filtrage
  applicatif** `.in('organization_id', orgIds)` (`getOrgIdsOfUser`) + garde TS
  fail-closed (`if (row.organizationId !== me.organization_id) notFound()`).
- **RLS présente mais bypassée** par le service-role → l'isolation repose sur le
  scoping applicatif : **toute requête de fiche doit être org-scopée**, et l'entité
  cible vérifiée contre l'org du viewer (fail-closed) avant tout rendu.
- `teams.organization_id` **existe** (NOT NULL depuis mig 237) → scoping équipe sûr
  (corrige la note de mémoire « teams sans organization_id »).
- **Kill-switch** `INTERVENANTS_PAGE_ENABLED` + `checkIntervenantsPageAccess` :
  à conserver pour les fiches Personne/Entreprise (surface intervenants). Réservé
  manager/admin (jamais chef_equipe sur autrui).
- **Audit log** : la consultation d'une fiche par un non-sujet doit être loggée
  (`logAuditEvent`) — pattern déjà en place sur `/intervenants/[id]`, à répliquer
  pour Personne/Entreprise. `/equipes/[id]` ne loggue pas aujourd'hui (à décider :
  cohérence ou statu quo). *À valider.*

---

## 10. Risques de performance / N+1
- Répliquer le pattern `actors-cockpit.ts` : requêtes parallèles `Promise.all` + index
  en mémoire (`Map`/`Set`), jamais de requête unitaire en boucle.
- **Interdit** : scanner toute une table par org puis filtrer en JS
  (`site_actions.in('organization_id', …)` pour une seule fiche). **Obligatoire** :
  filtrer par les ids pertinents (`assigned_contact_id`/`assigned_company_id` = le
  sujet ; `assigned_contact_id in [agents de l'équipe]`).
- Limiter les listes historiques (`limit()` explicite) + « voir plus » par lien.
- Index utiles présents : `sa_assigned_contact_idx`, `sa_assigned_company_idx`,
  `idx_missions_assigned_team`, `idx_interventions_assigned_team`.

---

## 11. Découpage & critères de sortie

### 2B.3A — Politique commune + fiche PERSONNE (la plus structurante)
Contenu : (1) `deriveActorAttentionState` pure + tests ; (2) retrofit de la ligne du
cockpit sur cette politique ; (3) read model `getPersonFiche(contactId)` org-scopé ;
(4) route + page fiche Personne ; (5) badge « Compte lié possible » sans fusion ;
(6) audit log + kill-switch.
**Sortie :** ouvrir un contact affiche identité, attentionState explicable (level +
raisons), actions référent + via entreprise, équipes/casting, décisions, visites
citées (marquées ⚠️), et liens sortants — sans jamais scanner une table entière.
Cockpit et fiche montrent le **même** état. Typecheck/lint/tests verts.

### 2B.3B — Fiche ENTREPRISE
Contenu : `getCompanyFiche(companyId)` (actions ouvertes/retard/sans référent,
chantiers + rôles, contacts, statut actif/historique) + route + page réutilisant la
structure 2B.3A + `attentionState` entreprise.
**Sortie :** ouvrir une entreprise répond « où intervient-elle, qu'attend-on d'elle »,
avec liens vers actions/chantiers/personnes. Placeholder exclu. Verts.

### 2B.3C — Fiche ÉQUIPE
Contenu : enrichir `/equipes/[id]` + `team-profile.ts` avec `attentionState` équipe et
le bloc « actions portées par les membres » (formulation §5.3), alignement visuel avec
2B.3A/B. **Pas de nouvelle route.**
**Sortie :** la fiche équipe partage la hiérarchie commune, affiche composition +
mobilisation + travail porté (sans prétendre à une responsabilité structurelle) et son
attentionState. Verts.

---

## 12. Décisions TRANCHÉES (Vincent 2026-07-27) — 2B.3A peut coder
1. **`attentionState` ✅** — `level` = **la raison la plus grave**, jamais une moyenne
   (urgent > attention > ok). `incomplete_profile` **très conservateur** : ne se
   déclenche QUE si une info manquante empêche un usage métier (ex. agent interne sans
   équipe — déjà couvert par `agent_no_team`). PAS d'alerte pour téléphone/e-mail/photo
   absents, ni « entreprise inconnue » d'un contact qui n'en a pas besoin. En v1
   `incomplete_profile` et `identity_incomplete` ne sont donc pas émis (le cas utile est
   déjà porté par `agent_no_team`). Priorité retard : un retard prime toujours (`urgent`).
2. **Routes ✅** — `/intervenants/personne/[contactId]`, `/intervenants/entreprise/[companyId]`,
   Équipe reste sur `/equipes/[id]` (ne pas créer 2 fiches Équipe concurrentes).
3. **Audit log ❌ reporté** — statu quo. 2B.3 crée des surfaces de LECTURE, ne change pas
   le comportement métier. Audit reporté à un futur chantier transversal (vaut aussi pour
   Personne/Entreprise : garde d'accès + kill-switch oui, log non). La garde reste
   `checkIntervenantsPageAccess` (privilégié + kill-switch).
4. **Visites citées (JSONB) ❌ reportées** — règle : *une fiche n'affiche que des
   relations structurellement fiables*. Reviennent quand une identité sera réellement
   reliée. Évite de perdre la confiance dans la fiche.
5. **Rythme / heatmap / galerie ❌ reportés** — priorité anti-sur-agrégation. La fiche
   répond « qui ? où ? que dois-je voir maintenant ? » ; ces vues viendront ensuite.

### 6ᵉ exigence ajoutée (Vincent) — la CARTE DE SYNTHÈSE
Chaque fiche s'ouvre sur une carte qui résume **en moins de 5 secondes pourquoi cet
acteur mérite (ou non) l'attention de Guillaume** : **identité + attentionState + les 3
faits principaux**. Exemples : Personne « Jean Dupont · À traiter · 2 actions en retard ·
ETV · Équipe Électricité · 2 chantiers » ; Entreprise « SOTRAP · À surveiller · 5 actions ·
2 sans référent · 3 chantiers » ; Équipe « Électricité · À jour · 6 membres · 2 chantiers ·
14 actions portées ». C'est **le point le plus important du 2B.3A** : si cette carte est
réussie, le reste de la fiche devient une navigation naturelle dans le détail.

### Ordre imposé des sections (jamais l'inverse)
**Situation actuelle → Organisation → Travail en cours → Historique → Navigation.**
On ouvre une fiche pour « que dois-je comprendre maintenant ? », pas pour lire l'historique.

### Vocabulaire
Le cockpit n'est pas une vue spéciale : il **consomme la politique commune**, comme les
fiches, comme le graphe demain. Ne pas parler de « retrofit » mais de *client de la politique*.
