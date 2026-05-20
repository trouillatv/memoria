# Étude — Page d'activité personnelle (« page Employé »)

**Date :** 2026-05-20
**Statut :** ÉTUDE doctrinale. ZÉRO code. Conditions de passage à l'implémentation listées §8.
**Demande Vincent verbatim :** *« Étudies cette page sans qu'on en fasse un module caché, on veut savoir ses heures, où il est intervenu, ce qu'il a fait, ce qu'il a enregistré, vu, rencontré, compris, où sont ses compétences et ses connaissances sur les sites. Regarder son nombre d'interventions, ses jours, ses heures. Mais je ne veux pas que MemorIA devienne un outil RH caché. »*

---

## 0. Pourquoi cette étude est dangereuse

Cette page est la **plus glissante** de tout le projet. Toute la doctrine MemorIA (V6.2/V6.8 « personne jamais sujet », V6.4 « pas de scoring », anti-surveillance) se joue ici.

**Quatre raisons concrètes pour lesquelles c'est plus dangereux que B1/B2 :**

1. **La pente est continue.** Il n'y a pas de frontière nette entre « compter les interventions » (OK) et « calculer une productivité » (toxique). C'est un curseur, pas une vanne.

2. **Le marché va pousser dans le mauvais sens.** Dès qu'un acheteur (gérant PME) verra la page, il dira *« ajoute-moi une moyenne par personne pour comparer »*. Sans garde-fou cristallisé, tu vas céder.

3. **La frontière dépend du contexte d'usage**, pas du contenu affiché. Le même chiffre (« 47 interventions ce mois ») est descriptif si le manager prépare une affectation, évaluatif s'il prépare un entretien annuel. Le code ne peut pas distinguer.

4. **Risque légal RGPD/droit du travail.** En France, l'employeur a des obligations sur les outils de monitoring du personnel. Une page qui agrège trop devient un dispositif RH soumis à déclaration / consultation CSE / information préalable.

Conclusion : si on construit cette page mal, on perd plus que de la doctrine — on prend des risques juridiques. À traiter avec une rigueur supérieure à toutes les précédentes études.

---

## 1. La distinction fondatrice à graver

| Activité OPÉRATIONNELLE (OK) | Évaluation RH (interdit) |
|---|---|
| Compter des faits passés | Juger ces faits |
| Mémoire individuelle isolée | Comparaison inter-personnes |
| Description neutre | Adjectifs qualificatifs |
| Présence accumulée | Performance calculée |
| Connaissances de contexte | Compétences notées |
| « A fait 14 interventions DASRI » | « Spécialiste DASRI » / « Mauvaise sur DASRI » |
| « Présente sur ce site depuis 18 mois » | « La plus expérimentée du site » |
| « A signalé 6 anomalies » | « Bonne / mauvaise dans la détection » |
| « A laissé 23 notes » | « Très / peu communicative » |

**Règle d'or pour le wording de chaque libellé de la page :**

> *Si tu peux remplacer le sujet de la phrase par « cet objet » sans que ça devienne absurde, c'est un FAIT. Si tu dois garder « cette personne », c'est probablement une ÉVALUATION.*

Exemple :
- *« Cet objet a accumulé 18 mois de présence sur le site »* — fait, transposable.
- *« Cet objet est efficace »* — absurde, donc évaluation cachée.

---

## 2. Les sections proposées — descriptives uniquement

Toutes les sections suivent un principe : **chiffres absolus, jamais relatifs**. Aucune section ne montre de comparaison avec d'autres personnes.

### Section A — Identité opérationnelle
- Nom, rôle, date d'entrée
- Sites où la personne est actuellement affectée

**Interdit :** photo, statut social, âge, données extra-professionnelles.

### Section B — Présence accumulée par site
Tableau :
| Site | Interventions | Première | Dernière | Notes laissées | Anomalies signalées |
|---|---|---|---|---|---|
| Aile pédiatrie | 14 | 12 jan 2025 | 18 mai 2026 | 6 | 2 |
| Bâtiment principal | 3 | 5 avril 2026 | 17 mai 2026 | 0 | 1 |

**Doctrinalement OK** parce que :
- Aucun jugement (« beaucoup », « peu »)
- Aucune moyenne, aucune comparaison
- Faits bruts traçables

**Pourquoi c'est utile sans dériver :** un gérant qui réaffecte une équipe voit immédiatement *« cette personne connaît déjà le site X »*. Pas *« est meilleure ailleurs »*.

### Section C — Activité récente
Liste chronologique des 20 dernières interventions de cette personne :
- Date, site, mission, durée déclarée
- Anomalies signalées si présentes
- Notes laissées si présentes

**Interdit :** moyenne de durée, écart à la moyenne, alerte « durée anormale ».

### Section D — Traces laissées (artefacts)
Liens vers les artefacts produits par cette personne :
- Notes terrain rédigées (liens cliquables)
- Anomalies signalées (liens)
- Photos prises (vignettes)
- Voice-notes validées (durée totale, pas le contenu)

**Doctrinalement OK :** ce sont les artefacts existants, déjà visibles ailleurs. Ici on les agrège *par auteur*, pas *par lieu*. C'est juste un autre angle d'accès aux mêmes données.

### Section E — Connaissances contextuelles
La section la plus délicate. Vincent demande « ses compétences et connaissances sur les sites ».

**Renommer en « expérience contextuelle »** pour évacuer le mot « compétence » qui implique notation.

Affichage :
> *« A déjà rencontré sur les sites où elle a travaillé : DASRI (8 mentions), accès badge (3 mentions), nettoyage zone humide (5 mentions), PC sécurité (2 mentions). »*

C'est un agrégat des mots-clés métiers (issus des mêmes lexiques que B1/B2) dans les notes/anomalies que la personne A LAISSÉES. Pas son score métier.

**Doctrinalement borderline mais OK** si :
- Le mot « compétence » n'apparaît jamais
- Aucun jugement sur la qualité de la rencontre
- Aucune comparaison entre personnes (jamais « Marie a 8 mentions DASRI, Pierre n'en a que 3 »)

### Section F — Dossier de transmission (seulement si la personne quitte)
Quand une affectation se termine (changement de site ou départ), génération automatique d'un récap pour le successeur :
- Sites laissés
- Particularités contextuelles à connaître (extraites des notes laissées par la personne)
- Continuités à préserver

**Doctrinalement OK** : c'est *de la mémoire collective transmise*, pas une évaluation. C'est même le geste le plus aligné avec la doctrine MemorIA (continuité opérationnelle, V5).

---

## 3. Ce qui est ABSOLUMENT interdit sur cette page

Liste non négociable, à graver en tripwires structurels :

- ❌ **Classement / ranking** : aucun ordre de mérite, aucun « top 3 », aucun tri par « performance »
- ❌ **Score qualité** : aucun nombre normé (étoiles, %, indice de fiabilité, etc.)
- ❌ **Productivité calculée** : aucun « X interventions / heure », aucun « efficience »
- ❌ **Moyenne comparative** : aucun « moyenne équipe = Y, cette personne = Z »
- ❌ **Heatmap de présence** : suggère surveillance temporelle
- ❌ **Alerts évaluatives** : « anomalie : durée moyenne 30 % au-dessus de la moyenne »
- ❌ **Inférences psychologiques** : « semble fatigué », « moins assidu », etc.
- ❌ **Adjectifs qualificatifs** : « performant », « lent », « rapide », « assidu », « rigoureux »
- ❌ **Comparaison automatique** : aucun affichage d'autres personnes en regard
- ❌ **Mots du lexique RH** : « entretien », « bilan », « évaluation », « performance », « productivité », « compétence notée »

**Test du regex doctrinal automatisé** : aucun fichier de la page ne doit contenir ces mots dans les variables / labels / fragments. Tripwire test à créer le jour de l'implémentation.

---

## 4. Garde-fous structurels (avant tout code)

### Garde-fou 1 — Audit obligatoire sur tout accès tiers
Toute consultation de la page d'activité d'une personne X par un compte ≠ X est loggée dans `activity_logs` :
- `entity_type='person_activity'`
- `entity_id=X`
- `action='consulted'`
- `metadata={consulted_by:userId, role}`

La personne X peut voir qui a consulté son activité, quand.

### Garde-fou 2 — Accès symétrique
La page d'activité de la personne X est visible :
- Par X elle-même (toujours, sans audit)
- Par admin / manager (avec audit)
- Par les chefs d'équipe : interdit par défaut

### Garde-fou 3 — Pilote par la personne d'abord
Avant qu'un manager puisse consulter, **la personne consultée doit pouvoir voir SA propre page**. Ça l'oblige à comprendre ce que MemorIA sait d'elle. C'est la disposition la plus saine doctrinalement et légalement.

### Garde-fou 4 — Information préalable (légal France)
Avant déploiement, écrire un texte court qui dit aux employés : *« MemorIA conserve la trace de votre activité opérationnelle (interventions, notes, anomalies) pour assurer la continuité des sites. Vous pouvez consulter à tout moment ce qui est conservé sur votre page d'activité. Aucun classement ni évaluation comparative n'est calculé. »*

À faire signer (ou au moins communiquer) avant tout accès manager.

### Garde-fou 5 — Pas de notification proactive
La page existe et est consultable. **Mais MemorIA n'envoie JAMAIS de notification du type « voici l'activité de X cette semaine »** au manager. Surveillance proactive = piège. Consultation active uniquement.

### Garde-fou 6 — Suppression du compte = anonymisation, pas effacement
Si une personne quitte l'entreprise, son compte devient anonyme (`deleted_at = now()`, `full_name = 'Ancien collaborateur'`). Les artefacts (notes, anomalies) qu'elle a laissés RESTENT en base parce qu'ils sont la mémoire du LIEU, pas la mémoire de LA PERSONNE. Cohérent avec [[memoire-operationnelle-augmentee]] : le lieu survit aux personnes.

---

## 5. Le nommage de la page (très important)

Le mot « Employé » est lui-même problématique — il suggère hiérarchie, rapport de subordination, évaluation.

**Propositions alternatives** :
- *« Activité de [Prénom Nom] »* — neutre, factuel
- *« Mémoire opérationnelle de [Prénom Nom] »* — aligné doctrine
- *« Page personnelle [Prénom Nom] »* — anglicisé, OK

**Interdit** :
- *« Fiche employé »* (RH classique)
- *« Profil collaborateur »* (RH masqué)
- *« Performance / tableau de bord X »* (évaluation explicite)

Choisi mon avis : **« Activité de [Prénom Nom] »**. Court, factuel, lisible.

---

## 6. Frontière finale — le test des 4 questions

Avant chaque feature ajoutée à la page, passer le test :

1. **Est-ce qu'un dirigeant pourrait utiliser cette donnée pour licencier ?** Si oui → interdit ou refactorer.
2. **Est-ce que la personne elle-même serait fière de voir cette donnée affichée ?** Si non → interdit.
3. **Est-ce qu'un audit du travail (URSSAF, médecine du travail, juridique) trouverait ça problématique ?** Si oui → revoir.
4. **Est-ce que ça aiderait Guillaume à prendre une décision opérationnelle (affectation, formation, continuité) — pas RH (sanction, prime) ?** Si non → c'est probablement RH déguisé.

---

## 7. Pourquoi cette page peut être un BIEN

Pour balancer le négatif des sections précédentes : si elle est faite **correctement**, cette page peut être ce qui distingue MemorIA des SaaS « RH terrain » concurrents.

Elle peut devenir :
- **L'outil de transparence** : « voici ce que l'entreprise sait de toi, c'est descriptif, tu peux le consulter, personne ne le score »
- **L'outil de continuité** : « voici ce qui sera transmis à ton successeur si tu changes de site »
- **L'outil de reconnaissance non-quantifiée** : « tu es présent ici depuis 18 mois, voici l'épaisseur de ce que tu as laissé »

Aucun concurrent SaaS terrain ne fait ça aujourd'hui. C'est aligné avec ton positionnement [[memoire-operationnelle-augmentee]].

Mais c'est aligné **uniquement si** la doctrine §3 est tenue.

---

## 8. Conditions de passage à l'implémentation

**Ne PAS coder cette page avant les 5 conditions suivantes** :

1. **Manifeste doctrinal public** — 5 principes courts publiés (au moins en interne) qui interdisent explicitement le scoring RH. Décision Vincent.
2. **Pilote Guillaume validé** — 21 jours d'usage réel B1/B2/AO sans cette page. Aucune urgence de développement de cette page avant que le produit existant ait été éprouvé.
3. **Tripwires doctrinaux** rédigés (regex automatisés sur les variables / labels) avant la première ligne de code.
4. **Information préalable employés** rédigée (1 page, langage clair, à communiquer avant la page accessible).
5. **Accord juridique** — au moins une consultation rapide avec un avocat droit du travail / RGPD pour valider que la disposition n'entre pas dans le cadre des « outils de contrôle de l'activité du salarié » avec les obligations associées.

**Si Vincent veut quand même prototyper avant que les 5 conditions soient remplies** : faire un MVP visible uniquement par Vincent lui-même (sa propre activité), pour ressentir ce que c'est de se voir sur cette page. Personne d'autre. Pas de manager qui accède.

---

## 9. Que faire MAINTENANT (rien de codé)

- Garder cette étude au chaud
- Continuer le pilote Guillaume (priorité absolue selon échange 2026-05-20)
- Quand Guillaume aura 30+ jours d'usage réel et que la doctrine sera cristallisée, revenir à cette étude pour décider de coder ou pas
- Ne pas coder pendant qu'on est encore en phase « le produit existant n'est pas validé »

---

**Cette étude est faite. Pas de code prévu avant ratification §8.**
