# Règles de modification

## Doctrine V5 — Lignes rouges absolues

Ces règles ne sont pas négociables. Elles protègent l'éthique du produit.

### Jamais de surveillance individuelle
- **Interdit** : métriques de performance par personne (temps par tâche, nombre d'actions, score individuel)
- **Interdit** : `assigned_to` sur les interventions — on affecte des **équipes**, jamais des individus
- **Interdit** : champs `capacity`, `max_load`, `charge_max`, `performance` sur les équipes
- **Interdit** : historique de navigation par utilisateur
- **Règle test** : "Est-ce que ce champ surveilance un humain ou organise une couverture ?"

### Jamais de CRM / pipeline commercial
- Pas de `deal_stage`, `pipeline`, `probability`, `mrr`, `arr`
- Pas de suivi de leads ou prospects individuels
- La mémoire commerciale (AO) = mémoire de décisions passées, pas recommandation automatique

### Jamais de GMAO / FM creep
- Pas de gestion de stock, d'actifs, de maintenance préventive
- Pas de module "équipement" ou "matériel"

### Jamais de résumé IA marketing
- Le rapport mensuel = faits terrain, pas de prose IA sur les "performances de l'équipe"

### Verrou V3 : "clôturé" pas "résolu"
- Un dossier de preuve est "clôturé" (acte juridique irréversible), jamais "résolu" (jugement de valeur)

### Verrou V4 : notes de site passives
- Notes de site = faits descriptifs (140 chars max), pas d'évaluation ni de jugement
- Exemple OK : "Code alarme changé en avril" / Interdit : "Chef d'équipe souvent en retard sur ce site"

---

## Patterns de code obligatoires

### Server Actions
Toute mutation doit :
1. Commencer par une vérification de rôle (`requireAdmin()` ou `requireAdminOrManager()`)
2. Valider les inputs avec Zod
3. Retourner `{ ok: true }` ou `{ error: string }` — pas d'exception
4. Appeler `revalidatePath()` après mutation

```ts
export async function myAction(formData: FormData) {
  const adminId = await requireAdmin()           // 1. Auth
  const parsed = mySchema.safeParse({ ... })     // 2. Validation
  if (!parsed.success) return { error: '...' }
  // 3. Mutation
  await revalidatePath('/my-path')              // 4. Revalidation
  return { ok: true }
}
```

### Client Supabase
- **Server client** (`lib/supabase/server.ts`) : tout composant serveur et server action non-admin
- **Admin client** (`lib/supabase/admin.ts`) : uniquement dans `app/admin/` et opérations système
- Ne jamais créer de client Supabase côté client (navigateur)

### Soft delete
- Jamais de `DELETE` physique sur les entités métier
- Toujours mettre `deleted_at = NOW()`
- Les requêtes filtrent sur `deleted_at IS NULL`

### Types
- Tous les types métier dans `types/db.ts` — jamais inline dans les composants
- Pas de `any` — si le type est inconnu, utiliser `unknown` et affiner

---

## Conventions de nommage

| Contexte | Convention |
|---|---|
| Termes domaine | Français (engagement, contrat, mission, intervention, preuve) |
| Code (variables, fonctions) | camelCase anglais |
| Fichiers | kebab-case |
| Server actions | suffixe `Action` (ex: `createMissionAction`) |
| Fonctions DB | verbe + entité (ex: `getMissionById`, `updateUserRoleAsAdmin`) |
| Composants React | PascalCase |
| Types interfaces | préfixe `Db` pour les types DB (ex: `DbMission`), pas de préfixe pour les types calculés |

---

## Données de test

- Toutes les données de test portent le préfixe `__test` (nom, titre, email)
- Le `globalTeardown` Vitest (`tests/teardown.ts`) nettoie automatiquement après chaque run
- Pour un nettoyage manuel : `npx tsx scripts/dev/cleanup-test-data.ts`
- Ne jamais laisser de données `__test` en production

---

## IA / prompts

- Les prompts sont versionnés dans `services/ai/prompts/`
- Ne pas mettre de logique métier dans les prompts — les prompts appellent du code, pas l'inverse
- Le provider IA est sélectionné par env var `AI_PROVIDER` — le code ne doit jamais hard-coder un provider
- Les tests utilisent toujours le provider `mock`

---

## Migrations DB

- Numérotation séquentielle : `NNN_nom_descriptif.sql`
- Jamais de modification d'une migration existante — toujours une nouvelle migration
- Documenter le pourquoi dans un commentaire SQL en tête de migration
- Vérifier l'impact RLS pour chaque nouvelle table

---

## Ce qu'on ne fait pas

- Pas de commentaire JSDoc multi-paragraphe — une ligne max ou rien
- Pas de `// TODO` dans le code livré — ouvrir une issue ou noter dans `10_JOURNAL_DECISIONS.md`
- Pas de feature flag — changer le code directement
- Pas d'abstraction prématurée — 3 lignes similaires ne justifient pas un helper
- Pas de `console.log` en production (uniquement `console.error` pour les erreurs serveur inattendues)
