# Évolution conceptuelle de MemorIA

> Ce document raconte l'**histoire conceptuelle** du produit — les bifurcations stratégiques, les déplacements de positionnement, les doctrines qui se sont cristallisées au fil des décisions.
>
> Il est complémentaire de :
> - `10_JOURNAL_DECISIONS.md` (journal technique détaillé, décision par décision)
> - `superpowers/doctrines/` (doctrines actives, par thème)
>
> Ce fichier-ci se lit **chronologiquement, comme un récit**. Il sert à comprendre comment le produit a évolué d'un outil de suivi à un système de continuité cognitive opérationnelle.
>
> Convention : à chaque cadrage stratégique majeur, créer une nouvelle entrée datée. Ne pas modifier les entrées antérieures (snapshot historique).

---

## Genèse — Le nom et le concept central

### Le nom : MemorIA
Le projet s'appelle **MemorIA**. Pas NetoIAge. Le nom inscrit dès l'origine le pari produit : **la mémoire**, pas le nettoyage. Le secteur d'activité de l'entreprise pilote (entreprise de nettoyage en Nouvelle-Calédonie) est le **terrain d'expérimentation**, pas la définition du produit.

### Le concept fondateur : Mémoire assistée à 3 couches
1. **Artefact brut** (photo, note vocale, signalement, intervention) — **jamais supprimé**
2. **IA propose** des interprétations, des liens, des résonances
3. **Humain valide** ou écarte

Cette structure pose immédiatement le **moat doctrinal** : MemorIA n'écrit pas la vérité, il propose des échos qu'un humain ratifie. L'IA générative ne produit jamais de **lecture finale** — elle produit des candidats qu'un manager filtre.

---

## Mai 2026 — Le cadrage stratégique

### 20 mai 2026 — Les 5 piliers du produit
Cadrage fondateur post-pilote. MemorIA s'articule autour de **5 piliers** :

1. **Sites** — la mémoire d'un lieu
2. **Contrats** — les engagements pris, leur traçabilité
3. **Interventions** — l'exécution documentée
4. **Équipes** — qui couvre quoi (conteneur logistique, jamais analytique)
5. **Atelier IA** — la salle de travail pour les AO et les défenses

Et **3 axes transverses** : mémoire, preuve, copilote sobre.

**Conséquence** : tout ce qui se construit doit appartenir à l'un de ces 5 piliers ou ne pas se construire. Pas de feature qui flotte entre les piliers ou qui en crée un sixième par opportunisme.

### 20 mai 2026 — Le moat formulé
*« Contextualiser, pas générer. »*

C'est le moment où le produit cesse d'être *« un dashboard avec de l'IA »* pour devenir *« une mémoire qui surgit au bon moment »*. Tagline interne : **« mémoire exploitable au bon moment »**.

Cette formulation guide la roadmap dite **ABCDE** :
- **A** — Réservoir de preuves (déjà en place)
- **B** — Relève automatique
- **C** — Moments mémoire
- **D** — Mémoire des décisions
- **E** — Mémoire temporelle

### 20 mai 2026 — Refus structurés
Pour protéger le moat, posent les **refus explicites** :
- Pas d'ERP RH
- Pas de pointage personnel
- Pas de GPS / géolocalisation
- Pas de surveillance comportementale
- Pas de KPI startup-style sur le dashboard

Le **test des 4 questions** est introduit : *« Est-ce que cette feature est du RH déguisé ? »* Si oui, refus.

### 20 mai 2026 — Discipline coût IA
*« Async pré-calcul + retrieval borné, jamais LLM live partout. »*

Cette doctrine évite que MemorIA devienne un puits financier. Le LLM est cher, donc on pré-calcule en batch nocturne ce qui peut l'être, et on n'appelle un LLM live que quand le contexte est strictement nécessaire (analyse AO sur action utilisateur, génération de mémoire technique sur demande).

### 20 mai 2026 — Convergence knowledge → documents
La table `knowledge_items` (savoir curé manuel) doit fusionner dans `documents` (bibliothèque vivante). Plan tracé, exécution échelonnée. Invariant des 2 sémantiques (curé vs vivant) préservé même après fusion.

---

## Mai 2026 — Les doctrines de la résonance

### 20-21 mai 2026 — Niveau B : la mémoire relationnelle
Les documents (CCTP, plans d'accès, fiches sécurité, mémoires techniques) doivent **dialoguer avec la mémoire terrain**. Un site qui a accumulé 50 interventions doit pouvoir « reconnaître » qu'un nouveau document AO de bio-nettoyage le concerne — sans pour autant générer de fausses connexions.

**Verrou produit** : pas de moteur d'hallucinations automatiques. Les seuils cosine ne sont **pas de la doctrine** — c'est mesurable, ajustable. La table `cross_store_resonances` est gated par `document_links` + `document_type` + `target_type` + `source_domain` (4 filtres AND obligatoires).

**Approche α** (lectures dérivées déterministes par lien-fort) en B1, **approche β** (pont sémantique pré-calculé) en B2 conditionnel.

### 21 mai 2026 — Écho juste, pas vérité
Critère humain pour évaluer la qualité des lectures IA : *« cette lecture est-elle un écho juste ? »* — pas *« cette lecture est-elle vraie ? »*. La justesse d'une résonance n'est pas binaire ; c'est une continuité plausible que l'humain reconnaît ou non.

### 21 mai 2026 — Jury 4 classes
Pour structurer le jugement humain sur les résonances proposées par l'IA :

1. **Écho juste** — continuité plausible, à conserver
2. **Parasite** — du bruit qui pollue
3. **Trop vague** — vrai mais inutilisable
4. **Dangereux** — pourrait égarer une décision

Chaque classe pointe vers un correctif différent (seuils, filtres, formulation, exclusion). Jamais binaire.

### 21 mai 2026 — Lien utile = aide à agir
Critère opérationnel pour les matchers IA : *« ce lien aide-t-il à AGIR, ou est-il juste sémantiquement intéressant ? »*. Précision prime sur rappel. Un lien sémantique correct mais opérationnellement inutile est rejeté.

### 21 mai 2026 — Litige : jamais lecture automatique
`document_type='litige'` est exclu **par défaut** de toute lecture, résonance ou citation automatique. Pas de risque qu'un litige soit ressorti par erreur dans un brief, un AO, ou un partage client.

---

## Mai 2026 — La transgression assumée

### 20-21 mai 2026 — Page Agent
**Décision difficile**. Le pilote (Guillaume) a besoin d'une vue par personne pour comprendre la continuité opérationnelle. Or la doctrine V6 disait *« personne jamais sujet d'évaluation »*.

Pivot : **transgression assumée sous 6 garde-fous techniques** :
1. Audit log obligatoire à chaque consultation
2. Pas de score numérique calculé
3. Pas de comparaison côte à côte
4. Wording strictement descriptif
5. Kill switch ENV (`INTERVENANTS_PAGE_ENABLED`)
6. Tripwire allowlist user_id (confinée à `lib/intervenants/`)

Ce moment cristallise une règle qui guidera tout le reste : *« toute ouverture doctrinale livre ses garde-fous CI dans le même changement »*. On ne re-litige pas sous pression terrain.

### 21 mai 2026 — Mode d'emploi Guillaume
Production d'un manuel utilisateur complet (`docs/MODE_EMPLOI.md` + `.docx`) à destination du pilote. Ton « manuel », pas technique. 20 sections + FAQ + glossaire.

Importance produit : la doctrine doit être **lisible** par un non-tech. Si on ne peut pas l'écrire en français simple, on ne peut pas la défendre en réunion.

---

## 22 mai 2026 — Le tournant : continuité opérationnelle

### Sprint Équipes A + B + C livrés
**Sprint A — Identité visuelle étendue** : couleur libre (hex), 18 icônes lucide ciblées, 3 variantes de badge (colored / dot / mono). Migration 077.

**Sprint B — Fiche équipe enrichie** : `/equipes/[id]` devient une vraie entité. Capital descriptif (5 compteurs), rythme 14j, heatmap 90j, sites favoris, contrats touchés, équipes voisines, spécialités déclarées. Migration 078.

**Sprint C — Passage de témoin automatique** *(le tournant)* : quand quelqu'un quitte/bascule, MemorIA compile en 2 secondes un brief immuable de la mémoire utile à transmettre (À savoir, anomalies, documents, équipes voisines pour back-up). URL publique partageable `/h/[token]` sans login. Migration 079.

### Le repositionnement majeur

Avant ce sprint, MemorIA était *« mémoire opérationnelle augmentée »*. Après, il devient :

> **« Un système qui empêche la perte de mémoire humaine dans les opérations terrain. »**
>
> **« Quand les humains changent, la mémoire continue. »**

C'est plus qu'une reformulation marketing. C'est un **déplacement de catégorie produit** :

| Avant | Après |
|---|---|
| Mémoire passive (elle est là, l'IA aide à la voir) | Mémoire active (elle est menacée, on la sauve avant disparition) |
| MemorIA **contextualise** | MemorIA **transmet** |
| Marché : nettoyage NC | Marché : tout secteur où des humains opèrent des lieux qu'ils ne possèdent pas (hôpitaux, sécurité, BTP, hôtels, facility, collectivités) |
| Concurrents directs : SaaS sectoriels | Concurrents directs : aucun produit ne fait vraiment ça |

### Le moat technique caché
Le passage de témoin est *« la feature la plus forte »* du produit parce qu'il **dépend de toute l'architecture mémoire** déjà construite :

documents · mémoire terrain · anomalies · résonances · liens sites · équipes · traces · chronologie · briefs · partage public · snapshots · contexte.

Un concurrent peut copier un dashboard, une checklist, un planning. Mais pour copier *« quand Sandrine part, Joseph récupère automatiquement ce qu'elle savait »*, il faut **tout le sous-jacent**. C'est là que l'**effet de stack** apparaît.

### Le snapshot immuable
Détail technique qui s'avère structurant : un brief, une fois généré, **fige son contenu**. Si on le rouvre 6 mois plus tard, il montre l'état au moment T, pas l'état mis à jour. Implications :

- **Audit** : on peut prouver ce qui a été transmis
- **Responsabilité** : on peut établir ce qui était su par qui à quel moment
- **Continuité** : la mémoire transmise ne se réécrit pas

Le snapshot immuable transforme le brief d'**information temporaire** en **objet opérationnel persistant**.

---

## 22 mai 2026 — Les implications du tournant

Suite au repositionnement, plusieurs doctrines complémentaires émergent dans la même journée :

### Philosophie de l'oubli
*« MemorIA n'oublie jamais factuellement, mais doit savoir mettre en sommeil. »*

Sans mécanisme d'oubli, la mémoire devient toxique. Joseph qui reçoit un brief avec 38 anomalies dont 80% sont anciennes ou résolues conclut *« ce site est un enfer »* — alors que le site fonctionne bien aujourd'hui.

Trois mécanismes complémentaires :
1. **Décroissance temporelle** par défaut (anomalies 6 mois, plans d'accès 2 ans, À savoir 1 an puis grisé)
2. **Résolution explicite** (geste humain volontaire qui bascule un artefact en archive)
3. **Supersession** (un artefact en remplace un autre, pas suppression brute)

Le slogan client devient : *« MemorIA n'est pas un disque dur, c'est un cerveau collectif. Il se souvient, il oublie, il actualise. »*

### Temps mémoriel
Cinq états du temps interne de MemorIA :
1. **Présent actif** — ce qui peut surgir maintenant
2. **Atténuation** — encore là, en arrière-plan
3. **Archive accessible** — consultable mais ne surgit plus
4. **Snapshot figé** — moments cristallisés (briefs, AO clôturés, dossiers preuves)
5. **Supersession** — chaîne de remplacement explicite

Vocabulaire produit explicable en une slide. Aucun concurrent ne parle comme ça.

### Discipline d'apparition
Une fois qu'on a la capacité technique de faire surgir de la mémoire **partout** (résonances, briefs, contextualisation), chaque idée nouvelle semble logique. Risque : transformer MemorIA en système total — lourd, lent, anxiogène, illisible.

**Test à 4 questions obligatoires** avant tout nouveau « moment où la mémoire doit surgir » :

1. Y a-t-il une vraie incertitude humaine à ce moment ?
2. L'absence de mémoire produit-elle une erreur opérationnelle concrète ?
3. L'humain peut-il AGIR sur ce que la mémoire lui montre ?
4. Le moment choisi est-il rare ?

Si une seule réponse est « non », **on ne livre pas**. Les idées rejetées vont dans un backlog « moments écartés ». On revient dans 6 mois pour vérifier qu'on avait raison.

**C'est LE sujet des 12 prochains mois.**

### Brief = moment magique
Le `/h/[token]` (brief partagé public) n'est pas un détail UX. C'est la **vitrine commerciale** du produit. C'est le moment où la mémoire devient visible pour un humain non-tech, sur WhatsApp, à 5h30 sous la lumière d'un parking.

Polish à venir : mobile-first absolu, QR code, PDF téléchargeable, acknowledged sans login, sommaire cliquable, métadonnées Open Graph.

### Continuité de mémoire anticipée (Sprint E proposé, différé)
Anticiper la perte de mémoire **avant** qu'elle arrive — savoir qu'un CDD se termine dans 14 jours et qu'aucun brief de continuité n'est préparé.

**Frontière doctrinale stricte** : le sujet grammatical est **toujours la mémoire**, jamais la personne. *« 3 sites portent une mémoire opérationnelle liée à cette équipe »* ✅. *« Risque de départ »*, *« agent critique »*, *« préparer le remplacement »* ❌.

Sprint E **passe le test des 4 questions** de la discipline d'apparition. Mais **différé** : il doit arriver après que la mémoire actuelle soit respirable (Sprint D) et après que Guillaume ait vécu la mémoire en pilote. Sinon installation irréversible de la perception *« MemorIA est le système qui sait qui va partir »*.

### Ordre des sprints validé
1. ~~Commit propre~~ ✅
2. **Sprint D** — mémoire qui sait vieillir (résolution, décroissance, atténuation)
3. **Polish léger `/h/[token]`** (mobile-first + QR)
4. **Observation Guillaume** instrumentée (critères chiffrés)
5. **Sprint E** — continuité anticipée *(seulement après 4)*

---

## Postérité — Ce qu'on retient

À cette date, MemorIA est en train de devenir :

1. Un **système de continuité opérationnelle** (pas un SaaS sectoriel)
2. Un système qui **stocke de la continuité humaine** (pas des tickets ou des tâches)
3. Un système qui a un **temps propre** (pas juste un historique)
4. Un système avec un **moat par effet de stack** (passage de témoin = somme de l'architecture mémoire)
5. Un système qui doit maintenant **apprendre la retenue** (discipline d'apparition + philosophie de l'oubli)

Le défi des 12 prochains mois n'est plus *« créer plus de mémoire »*. C'est :

> **« La mémoire reste-t-elle utile, supportable et crédible dans le temps ? »**

---

*Dernière entrée : 2026-05-22. À compléter à chaque cadrage stratégique majeur. Ne pas modifier les entrées antérieures.*
