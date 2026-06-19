# Checklist de tests terrain — session 2026-06-19

Tout ce qui a été livré en prod cette session. À tester sur un vrai chantier
(idéalement avec Guillaume BECIB + Émeline, et un cas Adrien / AGP).

Conventions :
- [ ] = à tester · noter : **marche / échoue / surprenant**
- 🛡️ = vérification doctrine (anti-RH, sources, jamais de jugement de personne)

---

## 0. Pré-requis
- [ ] `CRON_SECRET` ajouté dans Vercel (Production) → sinon `/api/cron/sweep-stuck-tenders` répond 401. (Plan gratuit = cron quotidien.)
- [ ] Dernier déploiement Vercel = commit le plus récent (build vert).

---

## 1. Génération PV / CR de chantier  (pilotes : BECIB ⭐ Émeline ⭐)
- [ ] Sur une réunion (`/meetings/[id]`), bouton **« Générer PV chantier »** → brouillon par sections.
- [ ] Éditer une section, **Enregistrer**, recharger → l'édition persiste.
- [ ] **Valider** → le PV passe en validé, **Télécharger PDF** fonctionne.
- [ ] Le PV validé apparaît dans **/documents** (cherchable).
- 🛡️ « Décisions **proposées** » (pas « prises ») ; une phrase conditionnelle (« on pourrait… ») n'est pas transformée en décision actée.
- 🛡️ Aucune info inventée ; éléments incertains marqués « à confirmer ».

## 2. Actions + échéances + curation desktop  (BECIB ⭐ Émeline)
- [ ] Panneau **« Qui fait quoi, pour quand »** : accepter une action proposée (titre/responsable/échéance éditables).
- [ ] Date **relative** dite en réunion → proposée + badge **« à confirmer »** ; date explicite → sans badge ; aucune date → pas d'échéance (jamais inventée).
- [ ] Modifier / ignorer une action ; le badge « à confirmer » survit après création.
- 🛡️ Wording centré action ; jamais « X est en retard » au sens reproche.

## 3. Suivi de la réunion précédente  (BECIB ⭐ + tous)
- [ ] En tête de réunion : compteurs **clôturées / ouvertes / en retard / sans responsable** corrects.
- [ ] Points critiques = actions en retard / anciennes, libellé action (pas personne).
- [ ] Présent aussi **en tête du PV** généré.

## 4. Tableau des engagements  (BECIB + tous)
- [ ] `/meetings/[id]` ou fiche : **« Engagements à suivre »** groupé par responsable.
- [ ] Bucket **« Sans responsable »** en tête. Doublons de libellé regroupés (D3T / d3t).
- 🛡️ Tri **alphabétique** (pas palmarès), pas de score, pas de classement de personnes.

## 5. Recherche mémoire étendue — S4a-1  (Adrien ⭐ AGP ⭐ + tous)
- [ ] « Interroger ce site » : une question retrouve désormais **actions / décisions / réserves / PV validés** (pas seulement anomalies/notes/photos).
- [ ] Confiance (forte/moyenne/faible) cohérente ; sources affichées.

## 6. Documents / CCTP dans la recherche — S4a-2  (Adrien ⭐ AGP ⭐)
- [ ] « que sait-on sur … » fait remonter un **document** (CCTP, marché, procédure) avec **nom du doc + lien**.
- [ ] Un document **lié au site** ressort ; un document **org-wide** (procédure/CCTP non rattaché) ressort aussi.
- 🛡️ Un document **admin_only** ne ressort pas pour un rôle inférieur ; un **litige** ne ressort JAMAIS.
- [ ] Hit document labellisé « proche » (sémantique), ne gonfle pas la confiance.

## 7. Réserves = mini-dossier  (Adrien ⭐ BECIB + tous)
- [ ] `/sites/[id]/reserves` : créer une réserve (+ photo avant), la **lever** (+ photo après + note).
- [ ] **Créer une action corrective** depuis une réserve ; **lier un document** ; les deux s'affichent dans la réserve.
- [ ] **Exporter PDF** (n° / statut / dates / photos avant-après / actions / documents).
- 🛡️ Vocabulaire « levée » (jamais « résolu »).

## 8. Passation / Continuité  (AGP ⭐ Adrien ⭐ BECIB Émeline)
- [ ] Générer une passation (équipe reprend un site **et** membre qui part).
- [ ] Le brief affiche : **réserves ouvertes · actions en retard · décisions récentes** + à savoir / anomalies / documents / équipes voisines.
- [ ] Lisible en ~2 min ; « en retard » signalé ; liens vers les surfaces.
- 🛡️ **Le brief parle du SITE, jamais de la personne qui part** ; aucun jugement, aucun score.

## 9. Sujets vivants  (les 4 pilotes ⭐)
- [ ] `/sites/[id]/subjects` : créer un sujet (ex. « Essais à la plaque »), statut open.
- [ ] Détail sujet : **rattacher** une action / réserve / décision / document existants → ils apparaissent dans le fil.
- [ ] Compteurs + **criticité** (point discret) cohérents ; passer en **sommeil** / **clos**.
- [ ] Question terrain : « où en est le sujet X ? » → la page sujet répond en un coup d'œil.
- 🛡️ Un sujet = problème/ouvrage/livrable, **jamais une personne** ; criticité dérivée discrète, pas un score anxiogène.

---

## Transversal (à garder en tête sur tous les écrans)
- 🛡️ Aucun classement / notation de personnes ; `assigned_to` = coordination.
- [ ] Mobile : les écrans clés (réunion, réserves) restent utilisables au doigt.
- [ ] Perf : les pages site / recherche répondent en < ~2 s sur données réelles.
- [ ] Coûts IA : la génération PV reste raisonnable (1 appel) ; la recherche = déterministe (0 IA).

## Retour à structurer (post-test)
3 colonnes : **ce qui marche · ce qui échoue · ce qui surprend** → pilote le prochain sprint
(candidats : S4b filtre sous-périmètre · embeddings async S4 · phase 2 sujets : anomalies/photos + recherche par sujet + bloc Passation « sujets ouverts »).
