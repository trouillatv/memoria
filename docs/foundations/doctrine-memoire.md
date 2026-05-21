# Doctrine de la mémoire — MemorIA

> **Comment la mémoire est construite, classée, vieillie, surfacée.**
> Les règles qui distinguent un système de mémoire opérationnelle d'un drive enrichi.

**Date** : 2026-05-22
**Statut** : Doctrine active.

---

## 1. La mémoire assistée à 3 couches

Le concept fondateur. Toute donnée passe par 3 couches qui ne se mélangent jamais :

1. **Artefact brut** — la trace originale : photo, note vocale, signalement, intervention documentée, document uploadé.
   **JAMAIS SUPPRIMÉ.** Soft-delete possible (audit), mais la donnée brute reste.

2. **Couche IA** — propose : résonances, liens, lectures émergentes, fragments narratifs.
   **JAMAIS DE VÉRITÉ.** L'IA produit des candidats avec source explicite.

3. **Validation humaine** — ratifie, écarte, atténue. Le manager filtre.
   **AUCUN AUTOMATISME COTÉ CLIENT.** Tout ce qui sort de l'IA passe par un humain avant d'être visible à l'extérieur.

Cette structure verrouille immédiatement le moat : **MemorIA n'écrit pas la vérité, il propose des échos qu'un humain ratifie.**

---

## 2. Le critère « écho juste »

Pour évaluer la qualité d'une lecture IA, on ne demande pas *« est-ce vrai ? »* — on demande *« est-ce un écho juste ? »*.

- **Écho juste** = continuité plausible que l'humain reconnaît
- ≠ Vérité (la mémoire ne prétend pas à la vérité)
- ≠ Information (l'écho n'est pas une donnée nouvelle, c'est une mise en résonance)
- ≠ Recommandation (l'écho ne dit pas quoi faire, il suggère un précédent)

Une lecture peut être *factuellement correcte* mais *un mauvais écho* — par exemple un rappel hors-contexte, ou trop évident, ou intempestif. À l'inverse, une lecture peut être *partielle* mais *un écho juste* — elle fait recroiser deux fragments qui méritaient de l'être.

C'est le seul critère qui compte côté UX. Si Guillaume dit *« ah ouais, c'est bien vu »*, c'est un écho juste. Si il dit *« mouais »* ou *« c'est pas le moment »*, c'est un mauvais écho et il faut corriger.

---

## 3. Le jury à 4 classes

Pour structurer le jugement humain sur les résonances :

| Classe | Description | Correctif |
|---|---|---|
| **Écho juste** | Continuité plausible utile | Conserver, renforcer |
| **Parasite** | Bruit qui pollue, faux positif | Renforcer les filtres |
| **Trop vague** | Vrai mais inutilisable | Affiner le seuil ou la formulation |
| **Dangereux** | Pourrait égarer une décision | Exclusion stricte |

Le jugement n'est **jamais binaire**. Chaque classe pointe vers un correctif différent. Quand on review les sorties IA, on compte les 4 classes — si on monte au-dessus de 30% de « parasites » ou >0% de « dangereux », on revoit la doctrine de génération.

---

## 4. Lien utile = aide à agir

Critère opérationnel pour les matchers (résonances, briefs, recommandations) :

> Un lien doit aider à **AGIR**. Jamais juste « sémantiquement intéressant ».

**Précision >> Rappel.** Mieux vaut 3 liens utiles que 30 liens vagues.

Test simple : *« quelle action concrète cette résonance ouvre-t-elle ?* »
- Si réponse claire (« cliquer sur le doc », « appeler le client », « préparer un brief ») → conserver
- Si réponse floue (« c'est intéressant à savoir », « c'est lié ») → exclure

---

## 5. Le silence positif

**Si rien à dire, l'IA se tait.**

Pas de carte « tout va bien ». Pas de tag « aucune alerte ». **L'absence parle**.

C'est contraire à l'instinct produit moderne (« remplir le dashboard »). Mais c'est la seule façon de protéger l'attention. Une UI qui parle tout le temps désensibilise. Une UI silencieuse rend chaque signal précieux.

Conséquence : MemorIA est volontairement frugal côté lectures. 1 fragment IA maximum par dashboard. Si pas de signal pertinent, rien.

---

## 6. La discipline d'apparition (post-sprint C)

Une fois qu'on a la capacité technique de faire surgir de la mémoire **partout**, chaque idée nouvelle semble logique. Risque : transformer MemorIA en système total, lourd, anxiogène, illisible.

**Test obligatoire à 4 questions** avant tout nouveau moment où la mémoire doit surgir :

1. Y a-t-il une vraie incertitude humaine à ce moment ?
2. L'absence de mémoire produit-elle une erreur opérationnelle concrète ?
3. L'humain peut-il AGIR sur ce que la mémoire lui montre ?
4. Le moment choisi est-il rare ?

Si une seule réponse est *non*, **on ne livre pas**. L'idée part dans un backlog « moments écartés ». On revient dans 6 mois pour vérifier qu'on avait raison.

C'est LE sujet des 12 prochains mois.

---

## 7. Le temps mémoriel (5 états)

MemorIA a un *temps propre*, distinct du temps de l'application :

1. **Présent actif** — ce qui peut surgir maintenant
2. **Atténuation** — encore là, en arrière-plan visuellement
3. **Archive accessible** — ne surgit plus, consultable si on la cherche
4. **Snapshot figé** — moments cristallisés (briefs de passage de témoin, AO clôturés, dossiers de preuves)
5. **Supersession** — un artefact en remplace un autre (chaîne explicite, pas suppression brute)

Vocabulaire explicable en une slide. Aucun concurrent ne parle comme ça.

---

## 8. La philosophie de l'oubli

> **« MemorIA n'oublie jamais factuellement, mais doit savoir mettre en sommeil. »**

Sans oubli structuré, la mémoire devient toxique. Joseph qui reçoit un brief avec 38 anomalies dont 80% sont anciennes ou résolues conclut *« ce site est un enfer »* — alors que le site fonctionne bien aujourd'hui.

Trois mécanismes complémentaires (sprint D, livré 2026-05-22) :

1. **Décroissance temporelle par défaut**
   - Anomalies : 6 mois de pertinence active (cutoff 90j dans les briefs)
   - Plan d'accès : 2 ans
   - « À savoir » sans `active_until` : 1 an puis grisé

2. **Résolution explicite (geste humain volontaire)**
   - Migration 080 : `intervention_anomalies.resolved_by`
   - Bouton « Résoudre » directement dans le brief (`HandoverPayloadView`)
   - Une fois résolue, l'anomalie sort de la mémoire vive

3. **Supersession**
   - `documents.supersedes_document_id` (existant)
   - À étendre conceptuellement aux « À savoir » et anomalies

Slogan client : *« MemorIA n'est pas un disque dur, c'est un cerveau collectif. Il se souvient, il oublie, il actualise. »*

---

## 9. Les sources persistées

Chaque lecture IA, chaque résonance, chaque candidat doit avoir une **source vérifiable** sous forme de tag : `[doc:id]`, `[trace:id]`, `[note:id]`, `[anomaly:id]`.

Sans source, pas de lecture. Sans source, l'humain ne peut pas vérifier, l'auditeur ne peut pas tracer.

Application concrète : les analyses AO persistent leurs sources documentaires (Sprint B documents A6). Les briefs de passage de témoin référencent les artefacts par ID dans leur snapshot JSONB immuable.

---

## 10. Snapshot immuable

Quand on cristallise un moment (brief de passage de témoin, AO clôturé, dossier de preuves, rapport mensuel), on **fige son contenu**. Un brief généré en mars 2026 montre mars 2026 même s'il est rouvert en juin.

Implications :
- **Audit** — on peut prouver ce qui a été transmis
- **Responsabilité** — on peut établir ce qui était su par qui à quel moment
- **Continuité** — la mémoire transmise ne se réécrit pas

Le snapshot immuable transforme la mémoire d'**information temporaire** en **objet opérationnel persistant**.

---

## 11. Les exclusions strictes

Certains types d'artefacts ne participent **jamais** à la mémoire émergente :

- **Litige** (`document_type='litige'`) — jamais source automatique d'une lecture, résonance ou citation. Même si la `visibility_level` passe. Consultable uniquement sur action humaine explicite.
- **Documents `superseded` / `expired` / `archived`** — exclus des briefs et des résonances par défaut.
- **Artefacts soft-deleted** (`deleted_at IS NOT NULL`) — n'apparaissent nulle part.

---

## Liens

- [Vision Produit](vision-produit.md) — le cadre global
- [Continuité opérationnelle](continuite-operationnelle.md) — le tournant
- [Sprint B1/B2](sprint-b1-b2.md) — la mémoire documentaire relationnelle
- [Passation](passation.md) — application concrète à la transmission
