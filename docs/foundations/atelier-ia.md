# Atelier IA — MemorIA

> **La salle de travail où plusieurs agents IA spécialisés challengent un dossier AO ensemble.**

**Date** : 2026-05-22
**Statut** : Doctrine active. 6 agents livrés en production, l'atelier est à 4 clics du dashboard (à réhausser en visibilité).

---

## Le concept fondateur

L'origine du projet est une conversation entre Vincent et ChatGPT en 2025. L'observation initiale :

> *« Au lieu d'un seul prompt ChatGPT, on déploie plusieurs agents qui ont chacun un rôle différent et qui se contredisent. C'est probablement le plus gros gap entre IA amateur et IA sérieuse. »*

L'idée a survécu à toutes les itérations. Elle est aujourd'hui le **différenciateur principal** côté commercial AO.

---

## Les 6 agents

Chaque agent a un **rôle clair**, un **prompt système distinct**, et peut analyser ou répondre indépendamment. Tous travaillent sur le même AO chargé.

### Agent 1 — Lecteur AO
**Rôle** : Lecture critique du cahier des charges.

**Sort** :
- Exigences extraites
- Contraintes (techniques, RH, sécurité, environnementales)
- Critères de notation pondérés
- Délais et pièces obligatoires
- Pénalités et clauses de résiliation
- **Attentes cachées** (ce que le client ne dit pas explicitement mais qui transparaît)
- Checklist de soumission
- Score de difficulté (interne, jamais exposé)
- Estimation des chances (interne, jamais exposé)

### Agent 2 — Stratège commercial
**Rôle** : Adapter le discours selon le secteur (école / mairie / industrie / bureaux / médical / copropriété).

**Sort** :
- Proposition de valeur reformulée
- Différenciation par rapport aux concurrents probables
- Arguments de confiance ciblés
- Vocabulaire client-friendly

### Agent 3 — Expert technique nettoyage *(« Terrain »)*
**Rôle** : Challenger le plan opérationnel.

**Sort** :
- Validation fréquence / produits / protocoles / sécurité / équipements / RH
- Détection d'incohérences ou de sous-estimations
- Oublis potentiels (par expérience terrain)

### Agent 4 — Contrôleur financier
**Rôle** : Vérifier la viabilité économique.

**Sort** :
- Marge prévisionnelle vs marge cible
- Coûts humains (effectif × heures × taux horaire)
- Frais de déplacement
- Consommables et amortissement matériel
- Risques de sous-chiffrage ou de pertes

> Cité dans le PDF originel : *« Beaucoup de PME gagnent des AO… puis perdent de l'argent dessus. Cet agent est extrêmement important. »*

### Agent 5 — Contradicteur *(le plus important)*
**Rôle** : Attaquer le dossier **comme un acheteur hostile**.

**Sort** :
- *« Pourquoi AGP serait crédible sur ce dossier ? »*
- *« Quelles preuves a-t-on de cette capacité ? »*
- *« Qu'est-ce qui manque manifestement ? »*
- *« Pourquoi le client choisirait un concurrent ? »*

C'est le **wedge entre IA amateur et IA sérieuse**. Une réponse AO sans contradicteur est statistiquement médiocre.

### Agent 6 — Mémoire technique *(« Générateur final »)*
**Rôle** : Produit le livrable final exploitable.

**Sort** :
- Mémoire technique structurée
- Planning d'intervention
- Procédures détaillées
- Engagement qualité
- Gestion environnementale
- Plan de continuité de service
- Protocoles sanitaires
- FAQ client anticipée
- Synthèse exécutive

### Agent transverse — Conformité
**Rôle** : Vérifier que la réponse couvre toutes les obligations légales/réglementaires (certifications, attestations, RC pro, RSE…).

---

## Modes d'usage

### 1. Analyse en parallèle (auto)
À l'upload d'un AO, les agents lancent leur analyse spécialisée. Chaque agent produit son rapport séparé, persisté dans `agent_analyses`.

### 2. Atelier conversationnel (manuel)
Le manager sélectionne 1 à 3 agents (chip box dans l'interface) puis pose une question. Les agents sélectionnés répondent **en se contredisant**.

Exemple :
- **Sélection** : Stratège + Contradicteur
- **Question** : *« Doit-on miser sur le prix bas ou sur la qualité ? »*
- **Réponse** : 2 paragraphes contrastés que le manager arbitre.

### 3. Génération mémoire technique (manuel)
Le manager clique « Lancer l'analyse Mémoire technique » → l'Agent 6 produit un brouillon complet réutilisable comme base de réponse.

---

## Discipline coût IA

L'atelier est **cher** en tokens. Doctrine appliquée :

- **Aucun appel auto en production** — les analyses se lancent **uniquement** sur action manager
- **Pas d'historique gonflant** — chaque appel est borné par le contexte minimal nécessaire
- **Embeddings pré-calculés** — la mémoire commerciale est embeddée en batch, jamais en live
- **Cache par AO** — la 2ᵉ ouverture d'un AO recharge les analyses persistées

Coût estimé par AO complet (6 agents) : ~5-10 F (XPF). Soutenable.

---

## Sources persistées

Chaque analyse agent persiste ses **sources documentaires** (`[doc:id]`, `[trace:id]`) dans `agent_analyses.sources`. La page UI rend ces tags cliquables vers les documents originaux.

Application de la [doctrine-memoire.md](doctrine-memoire.md) #9 : *« sans source, pas de lecture »*.

---

## La capitalisation cross-AO

Chaque réponse AO clôturée nourrit la **mémoire commerciale** :

- **AO précédents similaires** sont remontés avant qu'on rédige le suivant
- **Outcome** (`won` / `lost` / `withdrawn` / `not_responded`) est saisi + raison + tag
- **Note vocale 1 minute après dépôt** captée et rattachée — *« sur quoi on a parié, qu'est-ce qui était tendu, qu'est-ce que je sens »*

Cf. [roadmap-ao.md](roadmap-ao.md) pour le détail commercial.

---

## Le levier caché

L'atelier IA est aujourd'hui **codé, fonctionnel, à 4 clics du dashboard**. C'est la feature la plus différenciante du produit mais elle est **invisible**.

Item de roadmap **AO-2** identifié (memory `atelier-ia-levier-cache`) :
- Visibilité dashboard renforcée (entry point clair)
- 3 idées WOW :
  1. **Contradicteur permanent** — toujours actif, challenge en arrière-plan
  2. **Agent Terrain auto** — branché sur les anomalies et photos pour challenger en temps réel
  3. **Préparation finale** — agent qui assemble le PDF prêt à envoyer

À traiter après observation pilote.

---

## Refus doctrinaux

L'atelier IA n'est **pas** :
- ❌ un chatbot général qui répond à tout
- ❌ un assistant qui rédige tout seul (toujours sur action manager)
- ❌ un système de scoring d'agents (interdit)
- ❌ un outil de recommandation client (refusé)

Il **est** :
- ✅ une salle de travail où le manager **challenge** son propre dossier
- ✅ un démultiplicateur de vigilance
- ✅ un assemblage de perspectives complémentaires

---

## Liens

- [Roadmap AO](roadmap-ao.md) — l'intégration commerciale de l'atelier
- [Vision Produit](vision-produit.md) — l'atelier comme pilier 5
- [Doctrine mémoire](doctrine-memoire.md) — règles communes (sources, silence positif)
