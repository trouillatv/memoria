# Seed démo Nouvelle-Calédonie

> Script : `scripts/dev/reset-and-seed-nc-demo.ts`
> Données : `scripts/dev/nc-data.ts` (clients, sites, AO, noms NC, anomalies, libellés photos)

Reset complet + seed d'une base réaliste pour démo, screenshots, pilote, storytelling produit. Adapté au contexte **AGP Nettoyage Nouméa** et au territoire NC.

---

## ⚠️ Sécurité

Le script **refuse** de tourner sans **3 conditions** :

1. `NODE_ENV !== 'production'`
2. Argument `--confirm-reset-on=<sub-chaîne-de-ton-URL>` obligatoire. La sous-chaîne doit apparaître dans `NEXT_PUBLIC_SUPABASE_URL`. C'est une protection volontaire : tu dois recopier une portion de ton URL pour confirmer l'intention.
3. Flag `--yes` explicite pour appliquer (sinon : **dry-run** affichant les counts uniquement).

L'URL est aussi scannée pour des marqueurs typiques de prod (`prod`, `production`, `live`) — si détectés, abandon.

## Usage

```bash
# 1) Dry-run — montre ce qui SERAIT supprimé, ne touche rien
npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=<sub-of-url>

# 2) Exécution réelle
npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=<sub-of-url> --yes
```

Exemple si ton `NEXT_PUBLIC_SUPABASE_URL=https://abc1234567.supabase.co` :

```bash
npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=abc1234567 --yes
```

## Ce que ça crée

| Catégorie | Quantité | Détail |
|---|---|---|
| Tenders (AO démo) | 4 | CHT, Lycée Lapérouse, OPT-NC, Dumbéa Mall — marqués `[DEMO]` |
| Contracts | 4 | Convertis depuis les tenders, dates start 90j passées / end 365j futur |
| Engagements | ~22 | 5-6 par contrat, catégorisés (frequency, service_level, etc.) |
| Sites | 6 | CHT Magenta (2), Lapérouse, OPT Ducos + Koné, Dumbéa Mall |
| Équipes | 3 | Nouméa Centre, Grand Nouméa, Nord/VKP |
| Missions | ~10 | Récurrence daily/weekly avec checklists métier |
| Interventions | ~140 | 4 semaines d'historique mixte + 2 planifiées futures |
| Photos (SVG) | ~300+ | 3 par intervention terminée + photos anomalies |
| Anomalies | ~10 | Pluie, eau coupée, accès bloqué, etc. (catégories réalistes NC) |
| Validations | ~30 | Sur ~40% des interventions completed |
| Proof tokens | 3 | 3 scénarios démo (réclamation, reporting mensuel, renouvellement) |
| Comptes test | 5 | admin / manager / 2 chefs équipe / 1 démo |

## Comptes de test

Mot de passe commun (dev only) : **`Password123!`**

| Email | Rôle | Nom |
|---|---|---|
| `admin@netoiage.local` | admin | Anaïs Wamytan |
| `manager@netoiage.local` | manager | Jean-Marc Dubois |
| `chef.noumea@netoiage.local` | chef_equipe | Moana Tjibaou (équipe Nouméa Centre) |
| `chef.grandnoumea@netoiage.local` | chef_equipe | Sosefo Falelavaki (équipe Grand Nouméa) |
| `agent.demo@netoiage.local` | chef_equipe | Tiare Liu (équipe Nouméa Centre) |

⚠️ Ces comptes ont `must_change_password=false`. Ne JAMAIS les utiliser en production.

## Scénario de démo recommandé (5 minutes)

### Acte 1 — Le cockpit superviseur (1 min)
1. Login `manager@netoiage.local` / `Password123!`
2. `/dashboard` → 4 contrats actifs. La section "Demandent attention" peut être vide ou contenir 1 contrat selon le hasard du seed. Tous calés sur des organismes NC reconnaissables.

### Acte 2 — Un AO transformé en capital (1 min)
3. `/tenders` → 4 AO `[DEMO]`. Ouvrir le **CHT Gaston-Bourret**.
4. Vue **Mémoire technique** : le texte généré est cohérent (bionettoyage, climat tropical, CQP APH). Vue **Synthèse** : résumé exécutif.
5. Vue **Atelier IA** : présent mais vierge (aucun message). Pour démo, peut ignorer.

### Acte 3 — Le terrain (1 min)
6. Logout, login `chef.noumea@netoiage.local`. L'app redirige sur `/m`.
7. Liste de missions du jour. Sélectionner une intervention "in_progress" si présente, sinon "planned" → tap "Commencer".
8. Cocher 1-2 items checklist. Prendre une "photo libre" via le FAB → simule capture.
9. Compléter → "Mission terminée".

### Acte 4 — La preuve (1.5 min)
10. Logout, retour manager. `/preuves`.
11. Filtrer : taper "**sanitaires**" → résultats. Ouvrir un dossier avec anomalie (badge ambre visible dans la liste).
12. La page détail montre : meta band, photos avant/après, validation, anomalie. Card "**Préparer un dossier**" en haut.
13. Cliquer **Préparer le dossier** → modale ou page de génération PDF (selon implémentation actuelle).

### Acte 5 — Le partage client (0.5 min)
14. Ouvrir l'un des **3 proof tokens** générés par le seed (URLs affichées en fin de script — copier dans le navigateur en mode navigation privée pour simuler un client externe).
15. `/p/<token>` : document encadré, sous-header "Identités masquées", expiration affichée. C'est ce qu'AGP enverra au client mécontent.

## Recherches utiles dans `/preuves`

- `sanitaires` → toutes les interventions de mission "Sanitaires"
- `Magenta` → CHT
- `Dumbéa` → mall
- `Koné` → OPT agence nord
- Filtrer par site, ou par période (semaine passée)

## Parcours mobile `/m`

- Liste des missions du jour pour le compte connecté
- Page intervention : header, état (planned/in_progress/completed)
- Checklist tactile (cibles ≥ 52px)
- FAB Photo libre en bas droite quand intervention en cours
- Anomalie possible (modal avec catégories)
- Validation en fin via "Terminer la mission"

## Parcours `/semaine`

- Vue Site × Jour (primaire) — 7 colonnes (lundi à dimanche)
- Vue Équipe × Jour (secondaire) — toggle en haut
- Pas de KPI, juste organisation de la couverture
- Légende m/a/s en pied de grille
- Drag & drop pour réassigner équipe

## Limites connues

- **Photos = SVG placeholders** (pas de photos réelles). Affichage normal mais visuellement austère. Pour de vraies photos, prévoir un dossier `assets/seed-photos/` avec des JPG anonymisés.
- **Provider IA = `mock`** par défaut. Les analyses AO sont pré-générées (texte écrit en dur dans `nc-data.ts`). Pas d'appel API réel.
- **Atelier IA** : vide. Le seed ne génère pas de messages chat pour rester sobre.
- **Aucune intervention bloquée par RLS** : le seed utilise le service role qui bypass RLS. Les comptes de test verront tout ce que leur rôle autorise.
- **`activity_logs` et `ai_usage` ne sont PAS vidées** : ce sont des tables d'audit, on garde l'historique.
- **`users` ne sont PAS supprimés** — re-seed = idempotent sur les emails (réutilise les comptes existants).

## Re-jouer le seed

Le script est **idempotent sur les utilisateurs** mais **destructif sur tout le reste**. Re-jouer = full reset puis full insert. Sans risque de doublons.

## Cleanup manuel

Si le script échoue à mi-parcours et laisse la base dans un état incohérent, supprimer manuellement et rejouer :

```bash
# Force reset complet
npm run db:reset-and-seed-nc-demo -- --confirm-reset-on=<sub-of-url> --yes
```

Si les utilisateurs auth sont à dégager (rare), le faire depuis le dashboard Supabase Studio → Authentication → Users → supprimer les `*@netoiage.local`.

## Doctrine respectée

Le dataset NE contient PAS :
- Scores agent / KPI individuels
- Géolocalisation
- Heures travaillées / pointage
- Productivité / classement / saturation
- Gamification / streaks

Le dataset raconte : **« preuve du travail réalisé »**, pas **« contrôle des personnes »**.

Les exports publics (`/p/[token]`) masquent les identités par défaut. Override admin uniquement pour usage juridique.

## Voir aussi

- `docs/superpowers/doctrines/planning-doctrine.md` — doctrine V2 (organisation vs surveillance)
- `docs/superpowers/notes/2026-05-audit-ui-ux-pro-max.md` — audit pré-pilote (références écrans)
- `docs/superpowers/agents/agent-board.md` — système d'agents (qui review quoi)
