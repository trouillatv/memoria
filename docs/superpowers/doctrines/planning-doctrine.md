# Doctrine NetoIAge — V5 (mémoire opérationnelle par la preuve)

> ⚠️ **Cette V5 prévaut sur V3/V2/V1.** Elle ne porte plus uniquement sur le planning — elle définit la **nature du produit** entier, à la lumière de 6 scénarios humains analysés le 2026-05-13.

**Date V5** : 2026-05-13
**Statut** : V5 verrouillée — fondations comportementales gravées AVANT pilote terrain
**Portée** : TOUT le produit (et non plus seulement planning/missions/interventions)

---

## La phrase qui résume tout — V5

> **« NetoIAge est un système de mémoire opérationnelle par la preuve. Il réduit la charge mentale en augmentant la confiance. »**

Cette phrase remplace toutes les précédentes. Tout le reste découle.

---

## Principe directeur V5 (ajouté 2026-05-13 — gravé)

> **« Le système réduit l'incertitude opérationnelle. Il n'amplifie jamais le pouvoir hiérarchique. »**

Test final V5 pour toute feature : amplifie-t-elle le pouvoir hiérarchique (tracking timestamps, formulations injonctives, comparaisons inter-individus, classements implicites, surveillance d'usage) ? Si oui → refus, même si "humain qui signe" techniquement.

---

## Pourquoi cette V5 doit être gravée avant le pilote

Le terrain va injecter du bruit. Des demandes contradictoires vont arriver. Des urgences business vont pousser vers des dérives. La pression *"rajoutez juste ça"* peut casser silencieusement la doctrine.

**Le vrai danger maintenant n'est plus technique. C'est la dilution conceptuelle.** Cette V5 fixe les lois comportementales du produit avant que le terrain ne nous fasse oublier des nuances.

---

## Les 6 piliers V5

### Pilier 1 — La nature du produit

NetoIAge est un **système de mémoire opérationnelle par la preuve**. Pas un ERP. Pas un CRM. Pas un dispatching tool. Pas un SIRH. Pas un outil de ticketing.

Catégorie nouvelle. La continuité opérationnelle observée est une **conséquence** de la mémoire accumulée (12 mois de preuves que la concurrence ne peut pas copier). La mémoire est le mécanisme. La continuité est l'effet.

### Pilier 2 — Le critère de toute feature

> **« Est-ce que cette feature réduit la charge mentale ? »**

Si elle réduit le chaos, les oublis, les conflits, la préparation manuelle, l'anxiété de preuve, la dépendance à la mémoire humaine → elle est probablement dans la doctrine.

Sinon : danger de dérive.

Test corollaire :
> **« Cette feature augmente-t-elle la confiance dans le système, ou demande-t-elle plus d'énergie à l'utilisateur ? »**

Charge mentale ↓ et confiance ↑ sont **le même mouvement**, pas deux mouvements distincts.

### Pilier 3 — La règle des frontières humaines

> **« Le produit ne se bat jamais contre les outils humains déjà dominants quand ceux-ci remplissent mieux la fonction émotionnelle. »**

Exemple structurel :
- WhatsApp gagne la coordination chaude (7h45, un agent malade)
- NetoIAge gagne la preuve froide (rapport mensuel, dossier de preuves)

C'est une frontière saine, pas un échec.

**Corollaire critique** (révélé par l'Agent 6 — anthropologue pilote) :
> **« Mais NetoIAge doit empêcher le DG de transformer ces outils dominants en surveillance déléguée. »**

Si l'UI anonymise mais que le DG poste les noms dans WhatsApp groupe, la doctrine est cassée hors plateforme. Voir Maxim 9 ci-dessous.

### Pilier 4 — Le rapport au DG (auteur, jamais remplacé)

> **« Le produit ne parle jamais à la place du DG. Il amplifie sa voix. »**

Le DG reste l'auteur signataire :
- Voice note du DG sur le rapport mensuel (sa vraie voix vit dans ses notes vocales WhatsApp, pas dans le français-administratif)
- Signature manuscrite scannée sur les PDF
- Co-branding sobre où l'entreprise du DG reste le héros visible

Refus net : génération IA de la note du DG, "résumé automatique", "rapport intelligent", "synthèse IA". Tout texte généré machine désincarne le document et casse le moat.

### Pilier 5 — Le rapport à l'agent terrain (transparence)

> **« Le produit doit devenir oubliable pour l'agent terrain. Si Joseph pense au produit, le produit a échoué. »**

L'agent doit pouvoir ouvrir, prendre une photo, terminer, repartir — sans charge cognitive.

Le **vocabulaire de terrain** prime sur le vocabulaire consultant. Si le terrain dit "passage", le produit dit "passage" — pas "mission".

La **dignité** prime sur la fonctionnalité : "Bonjour Joseph" en H1 a plus de valeur psychologique qu'un dashboard sophistiqué. Reconnaître l'existence humaine sans surveiller.

### Pilier 6 — Le rapport au client final (infrastructure invisible)

> **« NetoIAge est l'infrastructure invisible de crédibilité, jamais la star du document. »**

Le héros visible du PDF doit rester l'entreprise cleaning (le prestataire du client final). Co-branding sobre :
- Logo prestataire à gauche, marque NetoIAge à droite (footer)
- Signature DG en bas
- URL stable de vérification

Le client ne veut pas un document "émis par un SaaS". Il veut un document **assumé par son prestataire**, soutenu par une infrastructure crédible.

---

## Distinction Pilier 4 ↔ Pilier 5 (cruciale)

Formulation unifiée :

> **« Le produit est transparent pour ceux qui exécutent, présent pour ceux qui signent. »**

- Joseph exécute → produit oubliable (Pilier 5)
- Patrick signe → produit amplifie sa voix (Pilier 4)
- Sylvie reçoit → produit s'efface derrière le prestataire (Pilier 6)

C'est la même doctrine vue depuis 3 personas.

---

## Maxims V5 (nouvelles)

### Maxim 9 — Surveillance hors plateforme

> **« Tout chiffre individuel sortant de la plateforme doit être anonymisé. Le DG ne nomme pas dans un canal collectif. »**

Concrètement :
- Tout export, copie, partage → anonymisation par défaut
- Briefing pilote : pas de bilan nominatif WhatsApp
- Coaching managérial du DG sur cette règle dès l'onboarding tenant
- La doctrine ne protège pas seulement l'UI — elle protège la **culture managériale**

### Maxim 10 — Confirmation personnelle uniquement

> **« Un agent ne confirme que ce qu'il a personnellement fait. »**

Concrètement :
- Si Joseph clôture une intervention exécutée en réalité par Jérémy (hors pilote), fausse trace `taken_by` qui casse V3 + crée une bombe juridique
- UX warning quand délégation détectée
- Protège la traçabilité juridique long-terme

---

## Test ultime V5 (consolidé)

Trois questions à appliquer à toute nouvelle feature, dans cet ordre :

1. **Charge mentale** : *« Cette feature réduit-elle le chaos, les oublis, l'anxiété de l'utilisateur ? »*
2. **Humains anonymes** : *« Si tous les humains étaient remplacés par des identifiants abstraits, la valeur métier resterait-elle intacte ? »* (V3, toujours valide)
3. **Frontière dominante** : *« Cette feature essaie-t-elle de gagner contre un outil humain dominant (WhatsApp, Excel) sur sa fonction émotionnelle ? »*

Une feature passe la doctrine **uniquement si** : réponse 1 = oui, réponse 2 = oui, réponse 3 = non.

---

## Le positionnement rare (cristal V5)

> **« Le produit rassure plus qu'il n'automatise. »**

La plupart des SaaS B2B essayent d'optimiser, mesurer, accélérer, surveiller, contrôler, remplacer.

NetoIAge fait l'inverse :
- **Stabilise** (mémoire qui ne s'efface pas)
- **Mémorise** (chaque preuve compte)
- **Rassure** (le DG sait, le client voit, l'agent oublie)
- **Protège** (les preuves en cas de litige)
- **Réduit** les conflits, les oublis, la dépendance à la mémoire humaine

Plus subtil que les concurrents. Plus difficile à copier. Plus durable.

---

## L'unité des features sous "mémoire opérationnelle"

Pourquoi cette catégorie est juste : elle **unifie** des features qui semblaient hétérogènes :

| Feature | Type de mémoire |
|---|---|
| AO gagné/perdu + raison | Mémoire **décisionnelle commerciale** |
| Rapport mensuel client | Mémoire **relationnelle client** (rituel) |
| Dossier de preuves | Mémoire **factuelle d'incident** |
| Renouvellement contrat | Mémoire **contractuelle long-terme** |
| Récurrence missions | Mémoire **opérationnelle quotidienne** |
| Audit ISO (futur) | Mémoire **qualité réglementaire** |
| Historique anomalies | Mémoire **des problèmes résolus** |

Toutes ces features accumulent **du contexte fiable dans le temps**. La concurrence ne peut pas copier le code — encore moins 12 mois de contexte. C'est le moat structurel.

---

## La doctrine doit survivre HORS de l'UI (cristal V5)

Un produit peut être éthique dans son interface tout en générant des comportements toxiques autour de lui :
- Export nominatif → screenshot WhatsApp → pression collective
- Humiliation implicite "Sandrine 0 photos cette semaine 😱"
- Micro-surveillance sociale au sein de l'équipe
- Détournement des données extraites pour évaluer

C'est précisément ce que la **Maxim 9** code. La doctrine V5 n'est donc pas seulement technique. Elle est **culturelle**.

**Conséquence stratégique** : NetoIAge a vocation à devenir un **manifeste public** — pas un secret commercial. Rendre les piliers V5 visibles à l'extérieur crée :
- Une **pression inverse** sur les utilisateurs ("je ne peux pas demander ça, c'est contre la charte")
- Un **filtre commercial** (les clients alignés se reconnaissent, les non-alignés s'éliminent)
- Un **positionnement intellectuel** difficile à copier (Salesforce ne peut pas dire "on ne mesure pas")

---

## Une nouvelle classe de features : "bridges vers outils humains existants"

Le bouton *"Partager les détails dans WhatsApp"* (reco 3.A) est l'archétype d'une classe entière de features futures :

- Faible complexité technique
- Énorme utilité pratique
- Respecte les usages humains enracinés
- Ne tente pas de remplacer un comportement profond

**Cette classe se distingue radicalement** de la classe "remplacement" qui caractérise la plupart des SaaS. Elle s'aligne avec le Pilier 3 (frontières humaines).

Exemples potentiels post-pilote (à ne PAS coder avant observation terrain) :
- Bouton "Copier le bilan mensuel dans la messagerie native"
- Export "Fiche site PDF" pour impression (le cahier de Joseph reste, mais NetoIAge l'alimente)
- Bouton "Envoyer ce dossier en pièce jointe à mon CRM externe"
- Lien iCal pour intégration calendrier Outlook (read-only, jamais l'inverse)

À chaque proposition future, appliquer le filtre :
> *« Cette feature lutte contre un outil humain dominant ou complète son usage ? »*

---

## Verrous complémentaires V5 (gravés 2026-05-13)

### Verrou 1 — Mémoire ≠ recommandation
Le système rappelle, contextualise, relie. Il ne recommande jamais une action commerciale.
- ✅ « AO similaire perdu pour 'prix' il y a 4 mois »
- ❌ « Baissez votre prix de 12% »

Verbes interdits côté système : baissez, augmentez, contactez, relancez, négociez, proposez.

### Verrou 2 — Briefing = sensation de maîtrise, jamais alerte
Neuroergonomie. Même contenu, formulation opposée.
- ✅ « Demain est couvert. 2 points méritent votre attention. »
- ❌ « 4 anomalies ouvertes. 2 sites à risque. »

Pas de chiffres bruts en début de phrase. Pas de couleur rouge. Toujours indiquer ce qui va bien AVANT ce qui demande attention.

### Verrou 3 — "Clôturé" pas "résolu"
Dans le cleaning, les problèmes ne sont presque jamais résolus définitivement. "Résolu" implique acceptation de responsabilité — juridiquement dangereux.
- ✅ « Dossier clôturé · Incident traité · Réclamation refermée »
- ❌ « Problème résolu · Issue closed »

### Verrou 4 — Le système ne suggère JAMAIS de formulation de contrôle humain
Le système ne propose pas de wording managérial dans les messages générés.
- ❌ « Pense à... », « N'oublie pas... », « Cette fois... », « Merci de... », « Attention à... », « Tu dois... »
- ✅ Formulations descriptives passives uniquement

Différence cruciale :
- ❌ « Fais attention au bloc B »
- ✅ « Bloc B : humidité signalée hier »

L'humain reste libre d'écrire ce qu'il veut. Le système ne le pousse PAS vers le micro-management. Sinon il devient un amplificateur de pouvoir hiérarchique passif-agressif.

### Verrou 5 — L'édition humaine est volontairement contrainte
Pas de textarea libre infinie = pas de mini-CMS quotidien = pas de charge mentale qui remonte.

Actions limitées autorisées :
- Toggle blocs ON/OFF
- Note libre ≤ 140 chars
- Emoji depuis palette restreinte
- Réordonner blocs

Refusé :
- Réécrire les bullets générés par le système
- Textarea libre infinie
- Brouillons longue durée
- Templates persistants

Sinon : Maeva passe 25 min/soir dans le système et le bénéfice disparaît.

### Verrou 6 — Aucun tracking de comportement humain interne
Pas de timestamp d'envoi persisté en DB. Pas d'historique d'actions du manager. Pas de fréquence d'utilisation.

Autorisé : badges UI temporaires (session/localStorage), purge automatique lendemain matin.

Refusé : `last_briefing_sent_at`, `briefing_send_count`, `last_login_at` exposés en admin, "Maeva a envoyé hier à 19h32".

Sinon : Patrick peut dire à Maeva « pourquoi tu envoies plus tard maintenant ? » → surveillance hiérarchique indirecte.

### Test consolidé V5 (4 questions, dans cet ordre)

Toute nouvelle feature doit répondre OUI / OUI / NON / NON :

1. **Charge mentale** : réduit-elle le chaos, oublis, anxiété ? (OUI obligatoire)
2. **Humains anonymes** : la valeur tient si humains = IDs abstraits ? (OUI obligatoire)
3. **Frontière dominante** : lutte-t-elle contre WhatsApp/Excel sur leur fonction émotionnelle ? (NON obligatoire)
4. **Pouvoir hiérarchique** : amplifie-t-elle un canal de surveillance ou de micro-management ? (NON obligatoire)

---

## Architecture conceptuelle V5

> **NetoIAge = couche mémoire / structure / preuve**
> **WhatsApp = couche émotionnelle / conversationnelle**
> **Le manager humain = hub entre les deux**

Le système prépare le plateau. L'humain choisit de servir.

---

# (Suite de la doctrine V3 ci-dessous — préservée comme socle historique)

# Doctrine Planning NetoIAge — V3

> **Document de référence** — toute personne (humain ou subagent IA) qui touche au planning, aux missions, aux interventions, au calendrier ou à l'app agent terrain DOIT lire et appliquer cette doctrine.

**Date V1** : 2026-05-10
**Date V2** : 2026-05-12 (évolution doctrinale post-feedback terrain)
**Date V3** : 2026-05-12 (participants contextuels — voir section V3 ci-dessous)
**Statut** : V3 verrouillée — prévaut sur V2/V1 où il y a contradiction
**Portée** : missions, interventions, planning, calendrier, app agent, vue semaine, équipes, **participants contextuels** (`/missions`, `/contracts/[id]/missions`, `/contracts/[id]/interventions`, `/m/*`, `/semaine`, `/equipes`)

---

## La phrase qui résume tout — V3

> **« On organise la couverture des engagements. On ne mesure jamais les humains. »**
>
> **« Connaître les humains dans un événement est autorisé. Calculer les humains est interdit. »**

Si tu hésites face à une décision, reviens à ces phrases. Tout le reste découle.

**Cette doctrine n'est pas philosophique. C'est une protection stratégique du positionnement produit.** Si on cède sur "on mesure les humains", NetoIAge devient un ERP parmi d'autres et entre en concurrence frontale avec Skello, Combo, Monday, Factorial, FM tools. La doctrine est le moat.

---

## V3 — Évolution doctrinale (2026-05-12, post-pivot participants)

### Le pivot V3

La V2 a installé l'équipe comme conteneur logistique unique. **Le feedback terrain a montré que c'était trop rigide** : un agent remplace un autre, Alpha aide Beta, le chef d'équipe réorganise le matin même, quelqu'un tombe malade. Le modèle "équipe fixe" **ment sur la réalité** — et le chef d'équipe maintient un WhatsApp parallèle. Cette **shadow surveillance hors plateforme** est plus dangereuse qu'une transparence cadrée dans l'app.

**Le pivot V3** : autoriser les **participants contextuels** à l'intervention, avec garde-fous structurels qui empêchent toute dérive vers un modèle de calcul sur l'humain.

### L'asymétrie fondamentale V3

> ✅ **« Participants de l'intervention X »** — autorisé
> ❌ **« Interventions de Pierre »** — interdit absolu

L'UI parle d'**événements** (interventions, missions, sites). Jamais de personnes en tant qu'objets de recherche ou de vue. La personne apparaît **comme participante à un événement**, jamais comme sujet d'une vue dédiée.

Cette asymétrie est **structurelle, pas cosmétique**. Elle est encodée dans :
- la DB (PK composite `(intervention_id, user_id)`, pas d'index user_id seul)
- les routes (pas de `/users/[id]`, pas de `/agents/[id]`)
- les exports (whitelist de colonnes, jamais d'identité agent dans un export par défaut)
- les helpers (interdiction `*ByUser`, `*ByAgent`, `rank*`, `*Stats`)

### Les trois couches de vérité humaine

| Couche | Statut DB | Sémantique | Confirmation requise |
|---|---|---|---|
| 🟦 **Équipe affectée** (`mission.assigned_team_id`, `intervention.assigned_team_id`) | Écrit en DB dès création | **Organisation prévue** | Aucune (signal organisationnel) |
| 🟨 **Participants contextuels** (`intervention_participants`) | Écrit en DB **uniquement après confirmation chef d'équipe** | **Réalité contextuelle** | Confirmation explicite |
| 🟩 **Actions nominatives** (`photo.taken_by`, `checklist_item.done_by`, `validation.validated_by`) | Écrit en DB à l'action | **Trace de preuve granulaire** | Implicite (l'action vaut confirmation) |

### Règle V3 — Non-écriture automatique de vérité humaine

> **« Ne jamais écrire automatiquement une vérité humaine non confirmée. »**

L'équipe affectée donne une **suggestion** de participants pré-remplie dans l'UI mobile chef d'équipe. **Rien n'est écrit en DB tant que pas confirmé**. Si non confirmé : état UI "Participants non confirmés", pas de faux positif en base.

Pourquoi : une vérité humaine fausse (écrite automatiquement) est pire qu'une absence de vérité. Les preuves juridiques sont attaquables si la base ment sur qui était là.

### Vocabulaire de rôles — V3

`intervention_participants.role` est un **enum strictement borné** à 2 valeurs :
- `participant` — exécutant simple, présence factuelle
- `referent` — point de contact opérationnel pour l'intervention (qui peut répondre si question)

**Refus net** des termes suivants même si demandés : `responsable`, `chef`, `lead`, `senior`, `junior`, `trainee`, `superviseur`. Ces mots encodent une hiérarchie qui glissera vers KPI/blâme/évaluation.

### Wording UI V3 — Autorisé vs Interdit

| ✅ Autorisé | ❌ Interdit |
|---|---|
| Participants à cette intervention | Présents aujourd'hui |
| Référent intervention | Responsable, chef, lead, senior |
| Qui participe ? | Qui est présent ? |
| Ajouter quelqu'un | Pointer / check-in |
| Équipe affectée | Agents actifs ce mois |
| Dossier de preuve de l'intervention | Historique de Pierre |
| Photos prises pendant l'intervention | Activité de Pierre |
| 3 intervenants identifiés (export anonymisé) | Productivité, rendement, score, classement |
| Participants non confirmés | Présence non validée, pointage manquant |
| (rien) | Ponctualité, retard, disponibilité, à l'heure |
| (rien) | Fiabilité, régularité, performance individuelle |

### Chevaux de Troie clients — Liste rouge V3

À chaque demande client, appliquer le test : *« est-ce que ça transforme NetoIAge en ERP RH ? »*

| Demande client | Réflexe doctrinal |
|---|---|
| « Combien de personnes sur mon site ce mois ? » | ✅ Agrégat numérique anonyme, OK |
| « Quels agents ont fait quoi ? » | ⚠️ Client : agrégat anonyme OK ; interne : refuser le reverse lookup |
| « Je veux noter mes agents » | ❌ Refus net. Pas le produit. |
| « Pour ISO il me faut prouver la qualification de l'agent » | ⚠️ Champ profil simple OK, planning by qualification refus |
| « Je veux planifier qui fait quoi la semaine prochaine » | 🚨 **Ligne rouge produit**. Person-level scheduling = ERP RH. Refus. |
| « Récompenser les bons agents » | ❌ Gamification = mesure. Refus. |
| « Tableau d'activité de mes équipes » | ⚠️ Coverage de sites = OK. Productivité humaine = refus. |
| « Suivre les remplacements » | ✅ Par intervention OK. Par agent (« Pierre a remplacé 12 fois ») refus. |
| « Application de pointage » | ❌ Refus. |
| « Heures travaillées pour la paie » | ❌ Pas le produit. |
| « Notifier un agent spécifique » | ❌ Refus. Communication via équipe. |
| « Pourquoi je ne peux pas voir l'historique d'un de mes agents ? » | ✅ Réponse cadrée : *« NetoIAge documente le travail réalisé, pas l'activité des personnes. C'est ce qui le distingue d'un ERP. »* |

### Hors-scope structurels — Refus net (même si demandé pendant l'implémentation)

| Sujet | Verdict |
|---|---|
| `assigned_to_user_id` sur mission/intervention | ❌ |
| Page `/users/[id]` ou `/agents/[id]` | ❌ |
| Filtre « intervenant » sur `/preuves` | ❌ |
| Colonne participants dans export Excel | ❌ |
| `joined_at` / `left_at` sur `intervention_participants` | ❌ (reporté Phase ultérieure si vraiment besoin lié incident) |
| Champs d'agrégat user-level (`user.total_*`, `user.last_active_at`, etc.) | ❌ |
| `user_availability` / `user_calendar` / `user_shift` | ❌ |
| `participation.evaluation` / `participation.rating` / `participation.note` | ❌ |
| `user.hours_worked` / `intervention.duration_per_user` | ❌ |
| Notifications nominatives à un agent | ❌ |
| `user.qualifications[]` utilisé pour planning automatique | ❌ |
| Rôles enum hors `participant | referent` | ❌ |
| Index DB sur `intervention_participants.user_id` seul | ❌ (anti reverse-lookup natif) |
| Helpers `*ByUser`, `*ByAgent`, `rank*`, `*Stats`, `getActivity*` | ❌ (test forbidden-symbols enforce) |

### Garde-fous structurels Phase 10 (enforcement, pas texte)

1. **Tests doctrinaux** : `tests/doctrine/forbidden-symbols.test.ts` grep le code pour symboles interdits. Build fail si trouvé.
2. **Export whitelist** : `tests/doctrine/export-whitelist.test.ts` scanne `*/export/route.ts` et `*/p/[token]/*` pour interdire colonnes type agent_name.
3. **PR template** : 5 cases doctrinales obligatoires (`.github/PULL_REQUEST_TEMPLATE.md`).
4. **Refusals log** : `docs/superpowers/doctrines/refusals-log.md` — registre des refus produit avec date, demande, motif. Toute demande refusée y atterrit pour mémoire collective.
5. **Pas de route `/users/[id]`** : verrou structurel. Une seule page liée à un utilisateur dans l'app = `/account` (son propre compte).
6. **Anonymisation par défaut export public** : `/p/[token]` masque les identités sauf option admin explicite avec justification écrite ≥ 20 chars + audit log entry.

---

## V2 — Évolution doctrinale (2026-05-12)

### Le pivot
La V1 a refusé toute couche organisationnelle (pas de `assigned_to`, pas de vue semaine, pas de drag & drop) par peur de la dérive RH. **Le feedback terrain a montré que c'était trop restrictif** : les superviseurs cleaning pensent naturellement en semaine, sites, équipes, remplacement. Si NetoIAge ne couvre pas cette couche, ils retournent sur Excel — et le mobile terrain décroche, le moat s'effrite.

**Le pivot V2** : le problème n'est pas le planning. Le problème est **qui devient l'objet du système**.

### Trois couches strictement distinctes

| Couche | Objet | Statut |
|---|---|---|
| 🟢 **Organisation** | Quoi faire, où, quand, par quelle ÉQUIPE | Autorisée, voire nécessaire |
| 🔴 **Surveillance** | Qui a fait quoi, en combien de temps, en retard, qualité individuelle | **Interdit absolu** |
| 💎 **Moat** | Preuves accumulées, réutilisation, dossier de preuves | Cœur produit |

### Le test ultime central — V2

> **« Si tous les humains étaient remplacés par des identifiants abstraits, la valeur métier resterait-elle intacte ? »**

- **OUI** → la feature est dans la couche Organisation ou Moat. ✅
- **NON** → la feature dérive vers Surveillance. ❌ refus.

Ce test prévaut sur le test V1 (« est-ce que cette feature aide à réaliser ou documenter une mission ? ») qui était utile mais pas assez tranchant.

### Le principe architectural V2

**On affecte à une ÉQUIPE, jamais à un AGENT individuel.**

L'équipe est un **conteneur de couverture**. Sa composition peut varier dans le temps sans impact sur les missions. L'agent terrain voit ses interventions **via son appartenance à une équipe**, jamais via une affectation nominative.

```sql
-- DB V2 :
ALTER TABLE missions ADD COLUMN assigned_team_id uuid REFERENCES teams(id);
ALTER TABLE interventions ADD COLUMN assigned_team_id uuid REFERENCES teams(id);
-- TOUJOURS INTERDIT : assigned_to_user_id sur mission ou intervention.
```

### Vue semaine V2 — autorisée mais discrète

Une grille Site × Jour devient autorisée. Mais avec 4 garde-fous :

1. **Pas un Gantt, pas un Outlook.** Pas de slots horaires précis. Créneaux nommés (matin/après-midi/soir).
2. **Vue Site × Jour = primaire.** Vue Équipe × Jour = secondaire/utilitaire, accès discret.
3. **Lent, macro, calme.** Pas de dispatch temps réel. Pas de Trello live. Pas de tour de contrôle.
4. **Aucune métrique d'équipe.** L'équipe est un conteneur logistique, pas une unité analytique.

### Liste rouge V2 — équipe comme KPI déguisé

Même sans métrique individuelle, les superviseurs vont naturellement comparer Alpha vs Beta. Le risque : "performance implicite d'équipe". **Interdiction explicite :**

```
❌ Charge équipe
❌ Saturation équipe
❌ Productivité équipe
❌ Taux complétion équipe
❌ Heatmap équipe
❌ "Équipe la plus utilisée" / "la moins utilisée"
❌ Indicateur de sous-utilisation
❌ Comparaison inter-équipes
❌ Score d'équipe
```

L'équipe affiche **uniquement** : sa composition (nombre de personnes) et les missions qui lui sont affectées. Aucune mesure.

### Liste rouge V2 — dispatch temps réel

Le produit peut éviter les KPI RH et devenir quand même une tour de contrôle anxiogène. **Interdiction explicite :**

```
❌ Drag/drop permanent / temps réel
❌ Micro-réassignations minute par minute
❌ Présence agent implicite ("en ligne", "actif")
❌ Vue "ce qui se passe maintenant"
❌ Refresh auto agressif
❌ Live cursor / collaboration temps réel sur le planning
❌ Notification supervisor "mission démarrée à l'instant"
```

Le planning reste **calme, macro, lent**. Pas de dispatch center.

### Page Équipes isolée

C'est le **SEUL endroit** où le superviseur voit des noms d'agents. Sur cette page :
- Composition des équipes (membres listés)
- Possibilité d'ajouter/retirer un agent d'une équipe
- **ZÉRO métrique individuelle** (jamais d'historique d'activité, jamais de stats)

Partout ailleurs en supervision : "Équipe Alpha (4 personnes)", jamais les noms.

### Vocabulaire V2

| ✅ Préférer | ❌ Éviter |
|---|---|
| Équipe Alpha | L'équipe de Mehdi |
| Couverture du site | Capacité d'équipe |
| Affecter une équipe | Assigner un agent |
| Remplacement d'équipe | Remplacement d'agent |
| Non-affecté | Sans staff |
| Réassigner l'équipe | Réaffecter Mehdi |
| Mission planifiée | Tâche assignée |
| Composition d'équipe | Effectif |

### Doctrine de réponse à la pression commerciale

Quand un client demandera "combien d'heures Mehdi a fait cette semaine ?" :

❌ NE PAS : "On peut ajouter ça"
❌ NE PAS : "Peut-être dans une V2"
✅ **DIRE** : "NetoIAge ne gère pas le temps de travail. Pour ça, branchez votre SIRH (Lucca, Skello, etc.). NetoIAge vous donne autre chose : les preuves de service rendu."

**Le scope assumé est le moat.** Élargir = devenir générique = perdre le positionnement.

---

---

## 1. Les 4 axes immuables

### Axe 1 — Mission-centric, pas human-centric

La boucle de référence est :
**Engagement → Mission (recette) → Intervention (instance) → Preuve.**

L'humain (agent, équipe) est **un attribut de l'intervention**, pas le sujet du système.

❌ Ne **JAMAIS** centrer une vue sur une personne (« le planning de Mehdi », « l'historique de Sofia »).
✅ Centrer sur la mission, le site, l'engagement.

### Axe 2 — Visualisation, pas optimisation

On affiche ce qui existe. On ne propose **JAMAIS** ce qu'il faudrait faire.

❌ Pas d'algorithme de tournée.
❌ Pas de heatmap.
❌ Pas de prédiction.
❌ Pas de suggestion automatique d'affectation.
✅ Liste, calendrier simple, filtres factuels.

### Axe 3 — Statuts opérationnels, pas mesures

4 états seulement pour les interventions :
`planned · in_progress · completed · validated`

**Aucune métrique** de durée, ponctualité, productivité visible.

### Axe 4 — Wording neutre toujours

Aucun mot qui implique un jugement sur la personne. La timeline est descriptive, pas évaluative.

---

## 2. Le test à appliquer à toute nouvelle feature

> **« Est-ce que cette feature aide directement à réaliser ou documenter une mission ? »**

| Réponse | Décision |
|---|---|
| ✅ Oui, directement | Go (ex: vue semaine, drag/drop affectation, template hebdo, duplication mission) |
| ⚠ Indirectement, mais mesure une personne | **Refuser** (ex: temps moyen agent, retard alerté) |
| ❌ Non, c'est de la RH/paie/optimisation | **Refuser net** (ex: pointage, tournée optimisée, calcul heures) |

**Refus par défaut** si la réponse n'est pas un OUI clair.

---

## 3. Glossaire wording — table verbatim

### ❌ Termes BANNIS

| Terme banni | Pourquoi | Remplacement |
|---|---|---|
| Retard | Implique un jugement | Mission non démarrée |
| Performance | KPI factory | Avancement |
| Productivité | Mesure individuelle | Suivi des missions |
| Pointage | Surveillance horaire | Démarrage / Fin (factuel) |
| Surveillance | Big Brother | Vue d'ensemble |
| Suivi agent | Tracking personne | Suivi des missions |
| Score | Notation | (rien — pas de score) |
| Classement | Comparaison | (rien — jamais) |
| Heures travaillées | Domaine paie | Plage de mission (factuel) |
| Tracker | Surveillance | (rien) |
| Temps de trajet | Optimisation tournée | (rien — pas calculé) |
| Productivité moyenne | KPI individuel | (rien) |
| Justification | Connotation négative | « Que s'est-il passé ? » / « Note rapide » |
| Non-conformité | Audit | Écart, à compléter |
| Audit | Big Brother | Revue, validation |

### ✅ Termes AUTORISÉS

| Terme | Quand l'utiliser |
|---|---|
| Mission planifiée / en cours / terminée / validée | États factuels |
| Avancement | % de tâches cochées dans une intervention |
| Mission | Recette opérationnelle |
| Intervention | Instance datée d'une mission |
| Affectation | Lien mission ↔ agent (factuel, non-évaluatif) |
| Couverture | % d'engagements couverts par missions |
| Prochaines missions | Vue future neutre |
| Historique | Vue passée descriptive |
| Note rapide | Champ texte court contextuel |

---

## 4. Demandes clients à refuser ou reformuler

Ces demandes vont arriver pendant les pilotes. **Réponse préparée = NON**, avec une reformulation possible vers un usage compatible.

| Demande probable client | Refus | Reformulation possible |
|---|---|---|
| « On peut pointer l'arrivée des agents ? » | ❌ | Le `started_at` de l'intervention existe déjà (factuel, jamais affiché comme un pointage). Pas d'extension RH. |
| « Voir qui est en retard ce matin ? » | ❌ | Vue « missions non démarrées ». Pas d'humain pointé. Si l'utilisateur veut savoir QUI, il ouvre l'intervention et voit `team[]` — c'est tout. |
| « Calculer les heures hebdo par agent ? » | ❌ | Export CSV des interventions, faites votre paie ailleurs (Skello, PayFit, autre). NetoIAge ne calculera jamais d'heures. |
| « Meilleure tournée pour mes 5 sites ? » | ❌ | Vous restez maître de l'ordre. Pas d'optimisation. |
| « Le planning de Mehdi cette semaine ? » | ❌ | Vue « missions du site X » filtrable. Vue centrée personne refusée. |
| « Notification quand un agent est en retard ? » | ❌ | Pas de notification. Vue dashboard async suffit. |
| « Dashboard RH avec présence/absence » | ❌ | Hors scope. RH = autre marché. |
| « Gérer les congés et absences » | ❌ | Hors scope. Outil RH dédié. |
| « Score de qualité par agent » | ❌ | **JAMAIS**. La qualité se mesure par engagement, pas par personne. |
| « Comparer mes agents entre eux » | ❌ | Refuser fermement. Toxique culturellement. |
| « GPS live des équipes terrain » | ❌ | Big Brother. CNIL/RGPD. Toxique. |
| « Alerte SMS/email si une intervention est en retard » | ❌ | Pas de notif urgente. Digest hebdo OK V1.1. |
| « Tableau croisé dynamique missions × agents » | ❌ | C'est de l'analyse RH déguisée. |

### Comment refuser sans casser la relation client

Toujours :
1. **Reconnaître le problème** sous-jacent (« Je comprends, tu veux savoir si l'équipe est ponctuelle »)
2. **Expliquer la doctrine** (« Notre produit est centré sur la preuve, pas le management individuel »)
3. **Proposer le contournement** (« Voici comment tu peux répondre à ce besoin avec ce qu'on a déjà »)
4. **Refuser fermement** la feature spécifique

Ne **jamais** dire « peut-être plus tard » sur ces demandes-là — c'est non, définitivement.

---

## 5. Données autorisées mais DANGEREUSES

Ces colonnes existent en DB pour la traçabilité de la preuve. Elles **ne doivent JAMAIS** être transformées en score individuel ou dashboard RH.

| Colonne | Pourquoi elle existe | Ce qu'on NE FAIT PAS avec |
|---|---|---|
| `interventions.started_at` | Timestamp de démarrage, factuel, oppose à la preuve | ❌ Pas de calcul de durée moyenne par agent |
| `interventions.executed_at` / `completed_at` | Timestamp de fin | ❌ Pas de classement « plus rapide » / « plus lent » |
| `intervention_photos.taken_at` | Timestamp serveur **opposable**, anti-fraude | ❌ Pas de mesure de fréquence par agent |
| `intervention_photos.taken_by` | Qui a pris la photo | ❌ Pas de score « % photos prises par X » |
| `intervention_checklist_items.done_by` | Qui a coché l'item | ❌ Pas de leaderboard « top tâches accomplies » |
| `intervention_checklist_items.done_at` | Timestamp du check | ❌ Pas de KPI temporel individuel |
| `intervention_validations.validated_by` | Superviseur ayant validé | ❌ Pas de classement validateurs |
| `intervention_anomalies.reported_by` | Agent ayant signalé une anomalie | ❌ Pas de « top reporters » (ferait peur, dissuaderait) |

### Règle ultime

Toute donnée individuelle est **agrégée par engagement, par mission, ou par site** — JAMAIS par personne.

Si une vue ou export commence à exposer un classement / score / metric individualisé, **refuser le merge**.

---

## 6. Featureset planning autorisé vs interdit (référence rapide)

### ✅ AUTORISÉ

- Vue jour/semaine des missions (lecture)
- Interventions planifiées listées chronologiquement
- Affectation simple via `interventions.team[]`
- Statuts : `planned · in_progress · completed · validated · skipped`
- Drag & drop léger pour replanifier (instance)
- Duplication d'une intervention
- Templates hebdomadaires de mission
- Filtres par site, par contrat
- Vue superviseur (read+write sur ses interventions)
- Vue agent (read+write sur ses propres interventions)
- Détection conflit basique (2 missions sur 1 agent en simultané) — **soft warning seulement**
- Export ICS/iCal read-only

### ❌ INTERDIT

- Pointage horaire
- Calcul d'heures travaillées
- Paie, cotisations, fiches de paie
- Temps de trajet
- GPS live, géolocalisation continue
- Optimisation algorithmique de tournée
- KPI productivité agent
- Classements / leaderboards agents
- Heatmaps RH
- Retards agressifs (notifications, alertes rouges)
- Dashboard de performance individuelle
- Gamification (badges, streaks, niveaux)
- Comparaisons inter-agents
- Vue planning « par personne » (vue par site/contrat OK)
- Notifications push « retard »
- Module gestion des congés
- Module gestion des absences

---

## 7. Composants existants — verdict

### ✅ Sains, à préserver

- `/contracts/[id]/missions` — visualisation pure des recettes
- `/contracts/[id]/interventions` — liste « À venir » / « Historique » sobre
- `/missions` (planning cross-contrats) — liste agréable
- `/m` (agent terrain) — liste perso sans mesure
- `/m/intervention/[id]` — checklist + photos + anomalies, jamais de score
- Cockpit Boucle de preuve (par engagement, jamais par personne)
- Dashboard direction (par contrat, jamais par individu)
- `intervention_validations` (validation factuelle, jamais évaluation)

### ⚠ À surveiller

- **`started_at` / `executed_at` / `completed_at`** : très facile de calculer un temps. Tant qu'on **n'EXPOSE PAS** de ratio par personne, c'est OK. Si une PR future commence à afficher « Sofia : durée moyenne 47 min », **refus immédiat**.
- **Notes d'intervention** (« Que s'est-il passé ? ») : champ libre OK car factuel et optionnel. **Ne pas** ajouter de catégorisation type « raison de retard » ou « cause de non-conformité ».

### ❌ Pièges futurs identifiés

Si quelqu'un propose un de ces écrans, **refuser direct** sans débat :

- Vue calendrier multi-agents avec lignes par personne
- Heatmap activité par jour
- Top/Flop missions terminées dans les délais
- Onglet « RH », « Équipes », « Pointage »
- Page agent avec son historique perso visible par admin (≠ son propre historique sur `/m`)
- Tableau Excel croisé agents × jours

---

## 8. Application aux subagents

Quand tu dispatches un subagent qui touche au planning :

### Inclure systématiquement dans le prompt

```
## Doctrine planning à respecter strictement

Lis docs/superpowers/doctrines/planning-doctrine.md avant de coder.

Règle cardinale : « Le planning sert la preuve, pas la gestion des humains. »

Ne JAMAIS implémenter (refuser même si demandé) :
- Pointage horaire
- Calcul d'heures travaillées
- KPI/score/classement par agent
- Notifications retard
- Optimisation tournée
- Vue centrée personne (« planning de X »)

Wording banni : retard, performance, productivité, pointage, surveillance,
score, classement, justification, non-conformité, audit.

Wording préféré : mission non démarrée, avancement, suivi des missions,
historique, couverture, note rapide.

Test à chaque feature : « Aide-t-elle directement à réaliser ou documenter
une mission ? » Si NON, refus par défaut.
```

### Vérification automatique en review

À chaque PR planning, faire ces grep checks :

```bash
grep -rin "retard\|productivité\|pointage\|score.*agent\|classement" \
  app/\(dashboard\)/missions/ \
  app/\(dashboard\)/contracts/ \
  app/\(field\)/ \
  | grep -v node_modules
```

Toute occurrence dans du code utilisateur-facing → **refus** ou refacto wording.

---

## 9. Évolution future planning

### Phase 4 planning hypothétique — règle de déclenchement

**Phase 4 ne sera lancée QUE si un pilote terrain réel montre une friction claire** sur la planification actuelle.

Pas d'anticipation. Pas de Google Calendar-like construit pour le plaisir. Pas de calendrier sophistiqué « parce que ça serait cool ».

> ⚠ **Avertissement** : la liste ci-dessous N'EST PAS une roadmap. C'est un **cap de scope** — les seules choses tolérables si la décision Phase 4 est un jour prise. Tout ce qui n'est pas dans la liste « inclus possible » ou est dans la liste « exclus définitivement » DOIT être refusé.

### Phase 4 hypothétique — version saine

**Goal** : améliorer la création et la lecture du planning, sans rien ajouter de RH-like.

#### ✅ Inclus possible (si demandé par 3+ pilotes terrain)

- Vue semaine type Google Calendar (mais en lecture, pas slot-by-slot)
- Templates hebdomadaires (« lundi-vendredi 8h-10h, équipe par défaut »)
- Duplication d'intervention (« mêmes paramètres demain »)
- Détection conflit basique (2 missions sur 1 agent en simultané) — soft warning seulement
- Filtre par site dans `/missions`
- Export ICS/iCal (read-only, pour intégration agendas externes)

#### ❌ Exclus définitivement, même en V5+

- Tout dashboard avec ratios par personne
- Tout suivi temps réel d'arrivée/départ
- Tout calcul d'heures cumulées
- Toute optimisation de tournée
- Toute notification « retard »
- Toute vue « qui fait quoi maintenant »
- Toute gestion d'absences/congés/plannings RH

---

## 10. Maxim 8 — ajout à la doctrine produit globale

Cette doctrine planning ajoute la **8e maxim** à la doctrine produit globale (les 7 maxims initiaux sont dans `engagement-cockpit-design.md` §10).

> **Maxim 8 :** Le planning sert la preuve, pas la gestion des humains. Toute donnée individuelle est agrégée par engagement, mission ou site — JAMAIS par personne.

---

## 11. Sanity check actuel (audit du repo au 2026-05-10)

| Élément | Verdict |
|---|---|
| `interventions.team` (uuid[]) | ✅ Sain — affectation factuelle |
| `intervention_validations.validated_by` | ✅ Sain — historique de qui valide |
| `intervention_photos.taken_by` | ✅ Sain — propriété de la preuve |
| `intervention_checklist_items.done_by` | ✅ Sain — qui a coché |
| `started_at` / `executed_at` / `completed_at` | ⚠ À surveiller — pas exposé en métrique individuelle aujourd'hui, ne JAMAIS le faire |
| Indicateur sync vert/jaune/rouge mobile | ✅ Sain — état de la photo, pas de l'humain |
| Cockpit Boucle de preuve | ✅ Sain — par engagement |
| Dashboard direction | ✅ Sain — par contrat |
| Vues `/missions`, `/contracts/[id]/*`, `/m/*` | ✅ Toutes saines |

**Aucune dérive détectée au 2026-05-10.** Le produit est aligné.

---

## 12. Maintenance de cette doctrine

- Toute modification de cette doctrine doit faire l'objet d'un commit dédié avec message commençant par `doctrine(planning):`
- En cas de pression client pour ajouter une feature interdite, **mettre à jour la section "Demandes à refuser"** plutôt que d'assouplir la doctrine
- Cette doctrine est **immutable** sur ses 4 axes principaux. Le glossaire et la liste de demandes peuvent évoluer.

---

**Validation V1** : doctrine validée par l'utilisateur le 2026-05-10.
**Validation V2** : évolution doctrinale validée par l'utilisateur le 2026-05-12. La V2 prévaut sur la V1 où il y a contradiction (notamment : vue semaine et affectation équipe deviennent autorisées sous conditions strictes).
