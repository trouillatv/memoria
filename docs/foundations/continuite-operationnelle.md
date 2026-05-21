# Continuité opérationnelle — MemorIA

> *« Quand les humains changent, la mémoire continue. »*

**Date du repositionnement** : 2026-05-22 (post-livraison sprint C, passage de témoin automatique).
**Statut** : Cadrage majeur — il prime sur les positionnements antérieurs (mémoire opérationnelle augmentée).

---

## Le tournant

Avant le 22 mai 2026, MemorIA était décrit comme *« mémoire opérationnelle augmentée »*. C'était juste mais incomplet — la mémoire restait **passive** (elle est là, l'IA aide à la voir).

Le sprint C (passage de témoin automatique) change la nature du produit. La mémoire devient **active** : elle est menacée, on la sauve au moment où elle va disparaître.

Ce déplacement n'est **pas un repositionnement marketing**. C'est la conséquence d'un mécanisme livré qui change ce que le produit fait pour ses utilisateurs.

---

## La rupture en une phrase

> **MemorIA est un système qui empêche la perte de mémoire humaine dans les opérations terrain.**

| Avant | Après |
|---|---|
| Mémoire passive | Mémoire active |
| MemorIA contextualise | MemorIA transmet |
| Marché : nettoyage NC | Marché : tout secteur d'opération terrain |
| Concurrents directs : SaaS sectoriels | Concurrents directs : aucun produit ne fait vraiment ça |

---

## Pourquoi c'est rare

La plupart des SaaS opérationnels **stockent**. Quelques uns **transmettent passivement** (« voici l'historique du site »). **Très peu** anticipent **la perte de mémoire humaine** comme événement opérationnel.

Le problème universel :
> *« Quand les humains changent, la mémoire opérationnelle disparaît. »*

Concerne :
- Nettoyage
- Hôpitaux (rotation soignants)
- Sécurité privée (agents qui changent)
- Maintenance industrielle
- Facility management
- BTP (chefs de chantier)
- SAV
- Industrie process
- Hôtels (gouvernantes, réception)
- Collectivités

**L'élargissement sectoriel se fait par mécanisme, pas par théorie.** Le code livré pour le pilote nettoyage NC sert sans modification à l'hôpital et à la sécurité.

---

## Les 4 mécanismes livrés

### 1. Le passage de témoin automatique *(sprint C, 22 mai 2026)*
Cf. [passation.md](passation.md) pour le détail.

Quand quelqu'un quitte/change d'équipe OU qu'une équipe prend un nouveau site, MemorIA compile **en 2 secondes** un brief de la mémoire utile à transmettre :
- À savoir (consignes persistantes)
- Anomalies récentes
- Documents rattachés
- Équipes voisines pour back-up

URL publique partageable `/h/[token]` sans login.

### 2. La mémoire qui vieillit *(sprint D, 22 mai 2026)*
Cf. [doctrine-memoire.md](doctrine-memoire.md) section #8.

Sans oubli structuré, la mémoire devient toxique. Le sprint D introduit :
- Décroissance temporelle par défaut (cutoff 90j sur anomalies dans les briefs)
- Résolution explicite (bouton « Résoudre » sur chaque anomalie)
- Âge visuel (« il y a 3 jours » plutôt qu'une date brute)

### 3. Le snapshot immuable
Un brief, une fois généré, **fige son contenu**. Implications :
- Audit — on peut prouver ce qui a été transmis
- Responsabilité — qui savait quoi à quel moment
- Continuité — la mémoire transmise ne se réécrit pas

### 4. Le partage public sans friction
`/h/[token]` est consultable sans login. Mobile-first absolu. QR code généré côté manager pour partage WhatsApp en 2 secondes.

C'est la **vitrine commerciale** du produit. Cf. memory `brief-moment-magique`.

---

## Le moat par effet de stack

Le passage de témoin est *la feature la plus forte* du produit parce qu'elle **dépend de toute l'architecture mémoire** déjà construite. Pour générer en 2 secondes le brief d'un site, il faut :

documents · mémoire terrain · anomalies · résonances · liens sites · équipes · traces · chronologie · briefs · partage public · snapshots · contexte temporel

Un concurrent peut copier un dashboard, une checklist, un planning. Mais pour copier *« quand Sandrine part, Joseph récupère automatiquement ce qu'elle savait »*, il faut **tout le sous-jacent**.

**Plus on enrichit une des couches, plus le passage de témoin s'enrichit automatiquement.** C'est compositionnel.

---

## Le déplacement de valeur

Aucun client n'achète :
- des dashboards
- de l'IA
- des embeddings
- des résonances

Les clients achètent :
- **moins de perte**
- **moins de chaos**
- **moins de dépendance aux individus**
- **moins de redémarrage à zéro**
- **plus de continuité**

Toutes les surfaces doivent être lisibles dans ce vocabulaire.

---

## La suite (Sprint E, différé)

### Continuité de mémoire **anticipée**

Aujourd'hui, le passage de témoin est *réactif* — quelqu'un part, on génère le brief. Demain, anticipé — on sait qu'un CDD se termine dans 14 jours, on prévient.

**Frontière doctrinale stricte** (cf. [doctrine-rh.md](doctrine-rh.md)) :
- Le sujet grammatical est **toujours la mémoire**, jamais la personne
- ✅ *« 3 sites portent une mémoire opérationnelle liée à cette équipe. »*
- ❌ *« Risque de départ », « agent critique », « préparer le remplacement »*

Sprint E **passe le test des 4 questions** de la discipline d'apparition. Mais **différé** : doit arriver après que Guillaume ait vécu la mémoire en pilote. Sinon installation irréversible de la perception *« MemorIA est le système qui sait qui va partir »*.

---

## Liens

- [Vision Produit](vision-produit.md) — le cadre global
- [Passation](passation.md) — le mécanisme cœur
- [Doctrine mémoire](doctrine-memoire.md) — les règles communes
- [Doctrine RH](doctrine-rh.md) — la frontière à ne pas franchir
- [EVOLUTION_CONCEPTUELLE.md](../EVOLUTION_CONCEPTUELLE.md) — le récit chronologique
