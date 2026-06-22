# Documentation MemorIA — Index

Trois documents majeurs, trois publics : **utilisation → technique → stratégie**.

| # | Document | Pour qui | Fichier |
|---|---|---|---|
| 1 | **Comment penser MemorIA** (conceptuel/fondateur) | utilisateurs, prospects, nouveaux collaborateurs | `01-COMMENT-PENSER-MEMORIA.md` |
| 2 | **Manuel Architecture IA** (vérité technique) | développeurs, mainteneurs, soi-même dans 2 ans | `02-ARCHITECTURE-IA.md` |
| 3 | **Manuel Utilisateur complet** (modules un par un) | utilisateurs en autonomie | `PLAN-MANUEL-UTILISATEUR.md` (structure) → à rédiger |
| — | *Vision produit* (investisseurs/prospects) | stratégie/vente | à créer |
| — | *Guide express Émeline* (10 p., captures) | usage quotidien | à créer (après le pilote) |

Le `/manuel` rendu dans l'app pointe vers `docs/MODE_EMPLOI.md` (manuel court existant).
Cette suite (`docs/manuel/`) est la documentation **longue et pérenne**.

---

## ⚙️ MAINTENANCE DU MANUEL UTILISATEUR

Ces documents sont conçus pour être **mis à jour automatiquement** au fil de l'évolution
de MemorIA. **Ne jamais réécrire le manuel** quand une fonctionnalité change. À la place :

**1. Scanner le projet** et identifier :
- nouvelles pages / routes (`app/(dashboard)/**`, `app/(field)/**`, espaces token)
- nouveaux concepts métier (nouvel objet, nouveau cycle)
- nouveaux parcours utilisateurs
- fonctionnalités supprimées

**2. Comparer avec le manuel existant.**

**3. Répondre d'abord (avant toute modification) :**
- Quelles sections sont devenues inexactes ?
- Quels nouveaux concepts sont apparus ?
- Quels nouveaux écrans sont apparus ?
- Quels parcours utilisateurs ont changé ?

**4. Mettre à jour UNIQUEMENT les sections impactées.**
- Conserver la structure et la numérotation existantes.
- Ajouter les nouveaux chapitres dans les sections appropriées.
- Marquer l'obsolète `[OBSOLÈTE DEPUIS …]` (ne pas supprimer brutalement).

> Le but n'est pas de réécrire. Le but est de maintenir une documentation **vivante**.

> Commande type : *« Rafraîchis le manuel utilisateur. Analyse le code actuel, compare
> avec le manuel existant, liste les écarts, mets à jour uniquement les sections
> concernées. Ne réécris pas le document complet. »*

**Stabilité par document** : le conceptuel (#1) ne bouge presque jamais (modèle mental) ;
le manuel des modules (#3) bouge avec l'UI ; l'architecture (#2) bouge avec le code.
Rafraîchir surtout #3 et #2 ; #1 seulement si un concept fondamental change.

**Dernière synchronisation : 2026-06-22.**
