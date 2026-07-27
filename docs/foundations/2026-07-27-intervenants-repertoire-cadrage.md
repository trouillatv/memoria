# Lot 2B.2 — Répertoire unifié des Intervenants · cadrage & wireframes

> Cadrage fonctionnel AVANT tout code. Fondé sur les données réellement
> disponibles (audit 2B.0 + liens ajoutés par 2B.1 : `site_actions.assigned_company_id`).
> Doctrine des surfaces : [[architecture-trois-surfaces]] — lier, jamais dupliquer.

## 1. Mission de /intervenants
« **Qui agit sur les chantiers, avec qui, où, et qu'attend-on de lui ?** »
Le **cockpit humain** de l'organisation. Il **agrège** trois natures d'acteurs
(personne, entreprise, équipe) — chacune reste dans son entité (`company_contacts`,
`companies`, `teams`), jamais fusionnée. Ce n'est ni un centre RH, ni un doublon de
Mémoire (les causes), ni des comptes-rendus (le récit). Il **oriente** vers les
surfaces propriétaires quand une question dépasse sa mission.

Ce n'est PAS : un gestionnaire de permissions, une base RH, un annuaire de comptes
(ça reste `/admin/personnes`).

## 2. Page d'accueil
Un bandeau de **compteurs actionnables** (chacun mène à une liste filtrée), une
zone d'**alertes déterministes** courte, puis les **onglets** + liste/recherche.
Aucun chiffre décoratif, aucun score.

## 3. Onglets
`Tous · Personnes · Entreprises · Équipes` — « Intervenants » = nom de la SURFACE,
pas d'une table. Filtres et recherche par onglet.

## 4. Indicateurs — uniquement ceux réellement dérivables
Légende : ✅ dérivable maintenant · ⚠️ définition/coût à cadrer · ❌ reporté (fiche/graph).

### Personne (`company_contacts` + `users`)
| Donnée | Source | État |
|---|---|---|
| Identité, catégorie (agent interne / contact externe / compte) | `company_contacts.is_internal_agent`, `company_id` ; `users.role` | ✅ |
| Équipes | `team_field_members` (contact) / `team_members` (user), actifs | ✅ |
| Entreprise de rattachement | `company_contacts.company_id → companies` | ✅ |
| Chantiers | casting `site_intervenants.main_contact_id` ; user → `missions.assigned_team_id` | ✅ |
| Actions portées / en retard | `site_actions.assigned_contact_id` (+ `due_date < today`) | ✅ |
| Dernière activité | pas de log par personne | ⚠️ (approx. via dernière action) |
| Rapprochement avec un compte | aucun lien structurel `user↔contact` | ❌ signal seulement (voir §7) |

### Entreprise (`companies`, hors placeholder « À identifier »)
| Donnée | Source | État |
|---|---|---|
| Chantiers actifs | `site_intervenants` actif | ✅ |
| Rôles dans les castings | `site_intervenants.role` | ✅ |
| Contacts | `company_contacts` par `company_id` | ✅ |
| **Actions ouvertes / en retard** | `site_actions.assigned_company_id` (+ `due_date`) | ✅ **NEW 2B.1** |
| **Actions sans contact référent** | `assigned_company_id` set ET `assigned_contact_id` null | ✅ **NEW 2B.1** |
| Statut actif / historique | présence dans un casting actif | ✅ |
| Dernière activité | — | ⚠️ (approx.) |

### Équipe (`teams`)
| Donnée | Source | État |
|---|---|---|
| Membres (connectés + terrain) | `team_members` + `team_field_members` | ✅ |
| Chantiers affectés | `missions.assigned_team_id` | ✅ |
| Actions portées par ses agents | `site_actions.assigned_contact_id ∈ agents de l'équipe` | ✅ (jointure) |
| Retards concentrés | somme des actions en retard de ses agents | ✅ |
| Personnes sans mission actuelle | agents d'une équipe sans chantier affecté | ⚠️ (définition à figer) |

## 5. Alertes déterministes (règles explicites, jamais d'inférence floue)
- Agent interne **sans équipe** (`is_internal_agent` sans `team_field_members` actif). ✅
- **Équipe sans membre** actif. ✅
- **Entreprise avec actions en retard**. ✅ NEW
- **Action sans responsable** (ni entreprise ni personne, statut open). ✅
- **Entreprise responsable sans contact référent**. ✅ NEW
- **Intervenants détectés non confirmés** (`site_knowledge_proposals` kind=stakeholder, status=proposed). ✅
- **Responsable historique plus mobilisé** (action dont l'entreprise a quitté le casting actif). ✅ NEW
- **Personne active sur plusieurs chantiers**. ✅

## 6. Statut d'un acteur (déterministe)
- **Actif** : présent dans un casting actif (entreprise/personne) ou une équipe/mission active.
- **Historique** : uniquement des liens passés (casting clôturé, action historique) — identité toujours résolue (cf. 2B.1), jamais masqué.
- **Incomplet** : agent interne sans équipe ; contact externe sans entreprise ni fonction ; entreprise sans contact. Sert les alertes, jamais un jugement.

## 7. Doublons `users` ↔ `company_contacts`
Pas de lien structurel (association reportée, décision Lot 1). Règle 2B.2 :
- **Ne jamais fusionner** automatiquement.
- **Signaler** un rapprochement potentiel (même e-mail, ou nom normalisé identique) via un badge « Compte lié possible » — sans agir.
- **Ne pas double-compter** la même personne dans les agrégats : dédup par clé d'affichage, ou présenter l'un comme « Compte » et l'autre comme « Fiche métier » avec le lien de rapprochement.
- Catégories d'affichage : *Compte sans fiche métier* / *Fiche métier potentiellement liée à un compte*.

## 8. Liens vers les surfaces propriétaires (jamais recopier)
- Une action → sa surface (chantier / réunion). Une décision → Mémoire.
- « Comprendre le contexte » d'une action → fiche action `/sites/{id}/action/{id}` (provenance). Cf. lot (e) roadmap.
- Le graphe causal reste dans **Mémoire** ; le répertoire ne le duplique pas.

## 9. Périmètre mobile
`/intervenants` est **desktop** (manager/admin ; kill-switch `INTERVENANTS_PAGE_ENABLED`).
Le terrain (`chef_equipe`, mobile) travaille sur les surfaces **par chantier** (casting,
équipe) — il n'a pas besoin d'un annuaire org global. **2B.2 = desktop uniquement.**
Une éventuelle entrée mobile (recherche d'un acteur) sera un lot distinct si un besoin réel émerge.

## 10. Reporté (fiches & graphe)
- **2B.3** : fiches détaillées personne / entreprise / équipe (réutiliser le pattern
  `getSite*Fiche` / `team-profile.ts`) + alertes enrichies.
- **2B.4** : graphe relationnel des acteurs (moteur canvas d'Explorer réutilisable),
  distinct du graphe causal de Mémoire.
- Association structurelle `user ↔ company_contact`.
- « Dernière activité » précise (nécessiterait un flux d'événements par acteur).

---

## Wireframes (desktop)

### Accueil `/intervenants`
```
┌ Intervenants ─────────────────────────────────────────────── [Rechercher…] ┐
│  Acteurs actifs 34   ·  Agents internes 12   ·  Entreprises 9  ·  Équipes 5 │
│  ⚠ 3 agents sans équipe · 2 entreprises avec retards · 4 détectés à confirmer│
├─────────────────────────────────────────────────────────────────────────────┤
│  [ Tous ] [ Personnes ] [ Entreprises ] [ Équipes ]         filtres ▾        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ▦ SOTRAP        Entreprise · Étanchéité · 3 chantiers · 7 actions (2 ⏰)     │
│  ◐ Jean Dupont   Personne · Agent · Équipe Électricité · 2 actions           │
│  ◑ Marie Martin  Personne · Conductrice · Intervenante du chantier           │
│  ▣ Équipe Gros œuvre  Équipe · 6 personnes · 2 chantiers · 5 actions (1 ⏰)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Carte Entreprise (onglet Entreprises)
```
┌ SOTRAP ───────────────────────────────────── Actif ┐
│ Étanchéité · rôles casting : ETV, sous-traitant     │
│ 3 chantiers actifs · 4 contacts connus              │
│ 7 actions ouvertes · 2 en retard · 1 sans référent  │
│ → Voir les actions   → Ouvrir la fiche (2B.3)       │
└─────────────────────────────────────────────────────┘
```

### Carte Personne
```
┌ Jean Dupont ────────────── Agent interne · Actif ┐
│ Électricien · Équipe Électricité                  │
│ Rattaché à : (aucune entreprise)                  │
│ 2 actions portées · 0 en retard                   │
│ [Compte lié possible : j.dupont@…]  → Fiche (2B.3)│
└───────────────────────────────────────────────────┘
```

---

## Décisions à arbitrer avant de coder 2B.2
1. **Confirmer desktop-only** pour 2B.2 (mobile reporté) ?
2. **« Dernière activité »** : approximation (dernière action liée) acceptable en v1, ou on l'omet ?
3. **Dédup users/contacts** : présenter les deux avec badge de rapprochement (reco), ou n'afficher que les `company_contacts` dans « Personnes » et laisser les comptes dans `/admin/personnes` ?
4. **Onglet « Tous »** : liste mêlée triée par pertinence, ou simple concaténation par type ?
5. **Périmètre v1** : liste + compteurs + alertes + liens (read-only), les **fiches détaillées** restant 2B.3 ?
