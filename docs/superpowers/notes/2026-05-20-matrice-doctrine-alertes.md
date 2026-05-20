# Étude — Matrice doctrine alertes (utiles vs dangereuses)

**Date :** 2026-05-20
**Statut :** ÉTUDE doctrinale. ZÉRO code. Conditions de passage à l'implémentation listées §9.
**Demande Vincent verbatim :** *« Alertes — étudier : alertes utiles ; alertes dangereuses. Alertes probablement bonnes : contrat bientôt expiré ; absence de preuve récente ; intervention non clôturée ; anomalie récurrente ; volume horaire dépassé ; accès site non restitué. Alertes probablement mauvaises : agent lent ; comparaison employés ; suspicion comportementale ; pression RH. Créer une matrice doctrine alertes. »*

---

## 0. Pourquoi cette étude est le rail commun

Toute la roadmap post-pilote en dépend :

- **P2 — Dashboard exploitation** ne montrera *que* ce que la matrice autorise comme alerte. Sinon il devient KPI startup.
- **AXE 3 — Copilote sobre** ne dira *que* ce que la matrice autorise. Sinon il devient copilote RH.
- **P3 — Historique agent** ne déclenchera *que* les alertes autorisées par la matrice côté personne.
- **Timeline site** et **Mémoire du site** ne surfaceront *que* ce qui est qualifié comme alerte ici.

Sans cette matrice : chaque nouvelle alerte se discute one-off, la doctrine s'effrite alerte par alerte, et MemorIA glisse vers la surveillance par accident. C'est exactement le scénario que [[doctrine-openings-pay-cost]] interdit.

Le mot « alerte » est l'angle d'entrée le plus banalisé vers la dérive surveillance — il faut le grever avant que le marché pousse dans le mauvais sens (cf. § page-personne « gérant qui demande une moyenne pour comparer »).

---

## 1. Définition fondatrice

Une **alerte** est un signal qui **interrompt** le flux normal de l'utilisateur pour proposer une action.

À distinguer impérativement de :

| Type           | Lieu                       | Initiative | Effet attendu                                |
|----------------|----------------------------|-----------|----------------------------------------------|
| **Alerte**     | Bandeau / liste vigilance  | Système → utilisateur | Action **explicite** (clic, décision)         |
| **Information**| Page / vue                 | Utilisateur consulte  | Compréhension passive, pas d'action requise   |
| **Résonance**  | Dans une lecture           | Système → utilisateur | « Écho juste » (cf. [[echo-juste-not-truth]]) |
| **Notification**| Push / SMS / WhatsApp     | Système → canal externe| Conséquence opérationnelle hors UI            |
| **Alarme**     | Rouge / urgence            | Système → utilisateur | INTERDIT en doctrine V2 sauf SLA contractuel  |

Conséquence : ce document ne traite **que** les alertes (et marginalement les notifications). Les résonances ont leur propre doctrine ([[jury-resonances-4-classes]]).

---

## 2. Le test ACID — 5 questions pour qualifier toute alerte candidate

Toute alerte candidate doit passer ces 5 questions. **Une seule réponse « rouge » suffit à la refuser.**

### Q1 — Sujet
> *L'alerte porte-t-elle sur un site / contrat / intervention / objet, ou sur une personne ?*
- 🟢 Objet (site, contrat, intervention, équipe-comme-conteneur)
- 🔴 Personne (user_id, agent, chef d'équipe nommé)

### Q2 — Action
> *Vers quel type d'action mène-t-elle ?*
- 🟢 Opérationnelle : réparer, refaire, signaler, programmer, contacter le site
- 🔴 Évaluative : sanctionner, classer, comparer, juger, archiver pour entretien

### Q3 — Comptage
> *Les données qui déclenchent l'alerte sont-elles agrégées par user_id ?*
- 🟢 Non, ou agrégées par site / contrat / mission
- 🔴 Oui — refus immédiat (cf. tripwire `planned-time-no-rh-aggregation` + [[refus-erp-rh-pointage-gps]])

### Q4 — Latence
> *L'alerte peut-elle attendre demain matin sans dommage opérationnel ?*
- 🟢 Non, l'action est utile maintenant (avant le prochain passage)
- 🟡 Oui mais c'est dans le flux quotidien (briefing matinal / récap fin de journée)
- 🔴 Oui et personne n'est censé la voir aujourd'hui → ce n'est pas une alerte, c'est de la vigilance

### Q5 — Densité (anti-bruit)
> *Si cette alerte sonne 10 fois par jour, devient-elle du bruit ?*
- 🟢 Non, par construction elle est rare (≤ 2-3 fois / semaine / site)
- 🟡 Possible — dedup + seuil + cooldown obligatoires (cf. [[lien-utile-aide-a-agir]])
- 🔴 Oui sans garde-fou possible → reclasser en information, pas alerte

**Une alerte qui sort 🟢 sur les 5 questions est candidate. Elle reste à valider §6 (hiérarchie attention) avant code.**

---

## 3. Matrice — alertes candidates qualifiées

### 3.1 Alertes UTILES (passent ACID)

| Alerte                                | Sujet      | Action                              | Q1 | Q2 | Q3 | Q4 | Q5 | Notes                                                  |
|---------------------------------------|------------|--------------------------------------|----|----|----|----|----|--------------------------------------------------------|
| Contrat bientôt expiré (J-30 / J-7)   | Contrat    | Préparer renouvellement / AO         | 🟢 | 🟢 | 🟢 | 🟡 | 🟢 | Briefing manager, pas push                              |
| Absence de preuve récente sur un site | Site       | Programmer un passage de contrôle    | 🟢 | 🟢 | 🟢 | 🟡 | 🟢 | Seuil paramétrable par type d'engagement                |
| Intervention non clôturée à J+2       | Intervention| Relancer chef équipe / clôturer       | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Cooldown : 1 alerte par intervention, pas 1 par jour    |
| Anomalie récurrente sur un site       | Site       | Investiguer, dialoguer client         | 🟢 | 🟢 | 🟢 | 🟡 | 🟡 | Définir « récurrente » : ≥ N occurrences même catégorie |
| Volume horaire CONTRAT dépassé        | Contrat    | Refacturer / renégocier / réaffecter  | 🟢 | 🟢 | 🟢 | 🟡 | 🟢 | Sujet = contrat. JAMAIS volume horaire par personne     |
| Accès site non restitué               | Site       | Récupérer les clés / badges           | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Déjà gravé V6 (preuve d'accès SPI)                      |
| Document litige sur ce contrat        | Contrat    | Alerter manager, **silencier IA**     | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Cf. [[litige-no-automatic-reading]] — l'alerte sert à activer la prudence, pas à exploiter |

### 3.2 Alertes DANGEREUSES (refusées)

| Alerte interdite               | Pourquoi (question qui pète)              | Si on cédait : pente vers           |
|--------------------------------|--------------------------------------------|--------------------------------------|
| « Agent lent »                 | Q1 🔴 (sujet personne) + Q2 🔴 (évaluatif) | Productivité, scoring, sanction      |
| « Comparaison employés »       | Q1 🔴 + Q3 🔴 (agrégation user_id)         | Ranking, prime, blâme                |
| « Suspicion comportementale »  | Q1 🔴 + Q2 🔴                              | Surveillance, droit du travail       |
| « Pression RH »                | Q2 🔴                                      | RH déguisé                           |
| « Agent absent fréquemment »   | Q1 🔴 + Q3 🔴                              | RH déguisé, droit du travail         |
| « Chef d'équipe n'a pas validé depuis N jours »| Q1 🔴 (porte sur la personne du chef) | Surveillance hiérarchique            |
| « X interventions ce mois (par personne) »    | Q1 🔴 + Q3 🔴                       | Comparaison déguisée                 |

### 3.3 Zones grises — à arbitrer explicitement

Ces cas ne sont **pas** tranchés par le test ACID seul. Décision Vincent attendue avant code.

| Alerte borderline | Lecture A (utile) | Lecture B (dangereuse) | Recommandation |
|---|---|---|---|
| « Cette équipe n'est pas revenue sur ce site depuis 6 mois » | Continuité opérationnelle : se rappeler du contexte avant la prochaine intervention | Statistique de présence par équipe → glissement vers RH | 🟡 **Conditionnel** : autoriser si sujet = SITE (« ce site n'a pas vu d'équipe régulière depuis 6 mois ») ; refuser si sujet = équipe |
| « Cette équipe a couvert N sites différents ce mois »       | Charge organisationnelle visible       | Productivité équipe                    | 🔴 **Refus** : Q1 borderline + Q3 borderline. Aucun bénéfice clair vs risque |
| « Aucun chef d'équipe disponible sur ce site demain »       | Vrai problème opérationnel              | Surveillance présence individuelle     | 🟢 **OK** si formulé site-side : « ce site n'a pas de chef d'équipe rattaché pour la prochaine intervention » |
| « Anomalie déjà signalée 3 fois sans réponse »              | Boucle de retour client cassée         | Pression sur l'agent qui signale       | 🟢 **OK** si sujet = anomalie/site, pas signaleur |
| « Cette intervention dure plus longtemps que d'habitude »   | Détection problème terrain              | Mesure productivité individuelle       | 🔴 **Refus** : Q3 rouge (« d'habitude » = moyenne agrégée). Reformuler en signal NEUTRE dans l'UI intervention (« durée saisie : 2h15 ») sans comparaison |
| « Photo manquante sur engagement obligatoire »              | Conformité contrat                      | Reproche au chef équipe                | 🟢 **OK** si formulé engagement-side : « l'engagement DASRI requiert une photo, aucune n'a été déposée » |

---

## 4. La règle d'or de wording

Inspiré de la règle de [[memoire-operationnelle-augmentee]] et § page-personne :

> *Une alerte est correctement formulée si tu peux remplacer le sujet par « cet objet » sans absurdité.*

Exemples :
- 🟢 *« Ce contrat expire dans 30 jours »* → remplaçable.
- 🟢 *« Ce site n'a plus de preuve depuis 12 jours »* → remplaçable.
- 🔴 *« Cet agent est lent »* → absurde si on remplace « cet agent » par « cet objet ». Verdict : évaluation.
- 🔴 *« Cette personne n'a pas validé depuis 5 jours »* → idem.

**Le code doit refuser à la compilation toute string d'alerte qui ne passe pas ce test.** C'est la prochaine ouverture doctrinale à instrumenter (tripwire CI lexical sur les libellés d'alerte).

---

## 5. Hiérarchie d'attention — 4 niveaux

Toute donnée signalable doit être placée à un niveau ; le système peut promouvoir ou rétrograder selon la densité, jamais l'inverse arbitraire.

| Niveau   | Surface                                       | Volume cible      | Quand                                          |
|----------|-----------------------------------------------|-------------------|------------------------------------------------|
| **1**    | Alerte (bandeau dashboard, vigilance semaine) | ≤ 5 par session   | Action attendue dans la journée                |
| **2**    | Information contextuelle (visible sur la page)| Illimité          | Si l'utilisateur cherche, il trouve             |
| **3**    | Résonance (texte qui émerge dans une lecture) | 0-3 par lecture   | Si « écho juste » (cf. [[echo-juste-not-truth]]) |
| **4**    | Silence positif (rien à signaler — c'est OK)  | Par défaut        | Aucune fatigue cognitive imposée                |

Doctrine de promotion :
- Une info N2 peut devenir alerte N1 si seuil dépassé (ex. 3 anomalies même catégorie = alerte).
- Une alerte N1 redevient info N2 quand elle est traitée (l'alerte ne disparaît pas, elle change de niveau).
- Une résonance N3 n'est **jamais** promue en alerte automatiquement (cf. [[litige-no-automatic-reading]]). Une résonance peut être épinglée manuellement par un humain → devient info N2.

**Le silence positif (N4) est un livrable, pas un manque.** Si une session se passe sans alerte, c'est un signal que l'exploitation va bien — pas un signal qu'il faut « ajouter du contenu » à la page.

---

## 6. Mécanique d'inclusion d'une nouvelle alerte

Toute future alerte (post-ratification de cette matrice) :

1. **PR explicite** avec section *« Test ACID »* remplie (5 questions, verdict par question, justification).
2. **Tripwire CI** : pattern qui détecte automatiquement
   - les `useAlert` / `pushAlert` / autres helpers à venir qui prennent un argument typé `user_id` ;
   - les libellés qui contiennent « agent », « personne », « employé » en tant que sujet de phrase.
3. **Allowlist documentée** : la liste des 7 alertes utiles §3.1 est gravée dans `lib/alerts/registry.ts` (à créer). Toute nouvelle alerte = nouvelle entrée explicite + PR + tripwire.
4. **Réversibilité** : toute alerte peut être désactivée par admin sans déploiement (flag table `alert_overrides`).
5. **Audit log** : chaque déclenchement d'alerte est tracé pour analyse post-pilote (volume, taux de clic, taux de silence).

**Cette discipline est non-négociable.** Sans elle, alerte #8 sera codée sans test ACID, alerte #11 ajoutera un sujet personne, et la matrice perd son rôle.

---

## 7. Distinction alerte ≠ notification

Les notifications (push / SMS / WhatsApp) ont une doctrine séparée à écrire (cf. roadmap). Règle provisoire :

- Une alerte N1 peut **devenir** notification si l'utilisateur n'est pas devant l'écran (preuve de présence : cf. accès SPI).
- Une notification ne porte JAMAIS un nom de personne dans le contenu visible côté canal externe (un screenshot WhatsApp d'une notif MemorIA ne doit jamais lire « Joseph est en retard »). Cf. *briefing pilote Guillaume* règle 1 — le pilote peut se casser hors-UI en 2 phrases.

---

## 8. Ce que cette matrice protège (vs ce qu'elle ne protège pas)

Protège :
- Glissement progressif alerte par alerte vers le scoring
- Acceptation tacite d'une alerte « il est urgent que… » qui pointe une personne
- Surcharge cognitive du dashboard exploitation (P2)
- Dérive du copilote sobre AXE 3 vers le copilote RH

Ne protège PAS (à traiter ailleurs) :
- Le wording des **résonances** → [[jury-resonances-4-classes]]
- Le surfacing **au bon moment** → étude à venir (« moments mémoire » P5)
- L'**obsolescence** d'une alerte ancienne → étude à venir (fraîcheur mémoire)
- Les **notifications externes** → étude à venir

---

## 9. Pré-conditions pour passer au code

Aucune alerte n'est codée avant que les 5 conditions soient remplies :

1. **Cette matrice est ratifiée** par Vincent (les 7 alertes §3.1, les refus §3.2, les arbitrages §3.3).
2. **`lib/alerts/registry.ts`** existe avec les 7 alertes encodées (sujet, action, formulation, niveau).
3. **Tripwire CI** détecte les libellés interdits (test rouge si « agent », « personne », « employé » apparaît comme sujet dans un libellé d'alerte).
4. **Audit log** branché (table `alert_events` : alert_key, scope_type, scope_id, triggered_at, acknowledged_at, dismissed_by — JAMAIS user_id de la cible).
5. **Premier livrable** = **2** alertes seulement (les 2 plus consensuelles : « contrat bientôt expiré » et « intervention non clôturée à J+2 »). On observe 14 jours d'usage avant d'ajouter les suivantes.

---

## 10. Décisions explicitement attendues de Vincent

Avant code :

- [ ] Ratifier la liste des 7 alertes utiles §3.1 (en retirer / ajouter / reformuler)
- [ ] Trancher les 6 zones grises §3.3
- [ ] Confirmer la hiérarchie 4 niveaux §5 (alerte / info / résonance / silence)
- [ ] Confirmer la règle d'or de wording §4 et la transformer en tripwire CI
- [ ] Confirmer la mécanique d'inclusion §6 (PR + test ACID + allowlist + audit log)
- [ ] Choisir les 2 alertes pilotes §9.5 (« contrat bientôt expiré » et « intervention non clôturée » par défaut ; modifiable)
- [ ] Décider du seuil « bientôt expiré » : J-30 / J-15 / J-7 ?
- [ ] Décider du seuil « intervention non clôturée » : J+1 / J+2 / J+3 ?

---

## 11. Lien avec les autres pierres doctrinales

- [[noyau-memoria-5-piliers]] — cette matrice cadre les piliers Contrats / Sites / Interventions et l'AXE 3
- [[refus-erp-rh-pointage-gps]] — Q1 / Q2 / Q3 du test ACID en sont la traduction opérationnelle
- [[doctrine-openings-pay-cost]] — la mécanique §6 est l'application directe (tripwire + audit + allowlist)
- [[litige-no-automatic-reading]] — les résonances N3 ne se promeuvent jamais en alertes
- [[lien-utile-aide-a-agir]] — Q5 (densité) en est la traduction côté alertes
- [[echo-juste-not-truth]] — distingue alerte (qui demande une action) de résonance (qui propose un écho)
- [[jury-resonances-4-classes]] — système de jugement parallèle pour les résonances
