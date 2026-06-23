# MemorIA — Mode d'emploi

MemorIA est la **mémoire opérationnelle** de vos chantiers : elle capte ce qui se
passe (réunions, photos, actions, décisions, preuves), s'en souvient, et vous
ramène la bonne information au bon moment — sans que vous ayez à chercher.

Ce manuel parcourt l'application **page par page**. Il est écrit en « vous » :
pour chaque écran, ce que vous voyez, ce que vous pouvez faire, d'où vient
l'information, et les garde-fous appliqués.

---

## Sommaire

1. Ce que fait MemorIA (et ce que ce n'est pas)
2. Première connexion & les rôles
3. Le cockpit quotidien (Tableau de bord, Aujourd'hui, Semaine, Briefing, Actions)
4. Chantiers & mémoire du lieu
5. Réunions & compte-rendu de chantier
6. Contrats, Missions, Équipes, Acteurs, Continuité
7. Recherche, Dossiers de démarrage, Bibliothèque, Glossaire, Preuves, Outils
8. Les liens & QR Codes (sans login) — qui sert à quoi

---

## 1. Ce que fait MemorIA (et ce que ce n'est pas)

### Ce que c'est
- Une **mémoire d'un lieu** (le chantier) et de ses objets (réserves, décisions,
  obligations, sujets, preuves).
- Un **assistant de préparation** : avant une réunion ou une visite, MemorIA dit
  ce qui traîne, ce qui mérite votre attention.
- Un **réservoir de preuve** : photos datées, déclarations signées, dossiers
  exportables — votre donnée reste la vôtre.

### Ce que ce n'est PAS
- Pas un **ERP**, pas un logiciel de **pointage**, pas de **GPS** des équipes.
- Pas un outil de **notation des personnes** : aucun score, aucun classement
  d'agents. Les chiffres parlent de la mémoire et du lieu, jamais de la
  performance individuelle.
- Pas un **gestionnaire de tâches** des entreprises : le QR capte une
  **déclaration**, il ne pilote pas leur travail.

### Pourquoi MemorIA est unique
Le moat n'est pas de générer du texte, c'est de **contextualiser la mémoire** :
retrouver ce qui s'est vraiment passé, raconter la durée (« ouvert depuis
143 j »), et survivre aux ruptures humaines (départ, absence, passation).

---

## 2. Première connexion & les rôles

### Accès
- URL : votre instance MemorIA (ex. `memorianc.vercel.app`).
- À la première connexion, un **mot de passe provisoire** vous est demandé puis
  vous devez le changer.

### Les rôles
- **Admin** — voit tout, gère les comptes et la configuration.
- **Manager / chargé d'affaires** — l'organisation, les chantiers, les réunions,
  les actions, la bibliothèque. C'est le rôle « bureau ».
- **Chef d'équipe / terrain** — une expérience mobile dédiée (« aujourd'hui ici »,
  photo, anomalie, tâche). Redirigé vers l'espace terrain. Il peut aussi **déclarer une
  livraison/évacuation** (+ photo) et **prendre en charge une intervention non affectée**
  pour son équipe afin de la démarrer (le gérant, lui, peut l'affecter à n'importe quelle
  équipe).
- **Entreprise externe** — pas de compte : elle reçoit un **lien public** (QR)
  pour déclarer ses actions ou confirmer une intervention.

> Astuce : la barre latérale propose un **Mode simplifié** qui réduit la
> navigation à l'essentiel (Recherche, Tableau de bord, Réunions, Actions, Sites)
> pour éviter l'effet « usine à gaz ».

---

## 3. Cockpit quotidien

Le cockpit quotidien est votre vue de commandement de la mémoire opérationnelle du chantier. Il condense ce qui se passe aujourd'hui, demain et cette semaine, sans jamais juger la performance des équipes.

### Tableau de bord (/dashboard)

C'est votre premier point de contact au matin. MemorIA n'affiche que ce qui compte : un message principal de mémoire active, puis la vie des lieux en détail.

#### Votre premier chantier
Si vous n'avez jamais créé de chantier, une carte d'accueil vous guide en trois étapes : **Créer votre premier chantier** (le lieu où s'accumule la mémoire) → **Démarrer une réunion** (voix ou notes → compte-rendu, actions, décisions) → **Suivre les actions** (ce qui reste à faire, à confier aux entreprises). Une fois la boucle lancée, vous accédez au cockpit complet.

#### Mémoire active ce matin
Une seule section en tête (jamais plusieurs), ou silence vert assumé si tout est calme. Elle remonte le plus critique du moment : passations à préparer, dossiers de démarrage à rendre, résonance terrain récente, signalements 24 h, état des lieux à surveiller. La couleur monte selon la criticité (ambre = attention, rouge = fragilité, vert = stable).

#### Ligne mémoire
Trois panneaux : **État de la continuité** (santé du relais entre équipes), **Temps mémoriel** (mini heatmap 12 semaines, résonance de chaque lieu), **Dernière mémoire utile** (4 événements récents pertinents).

#### Vie des lieux
Un fil unique regroupé par type (attention opérationnelle, continuité, dossiers de démarrage, mémoire terrain). Chaque ligne est cliquable vers le détail. Aucune métrique de charge : on voit ce qui se passe, pas qui travaille.

#### Nouveau depuis votre dernier passage
Une couche discrète en tête (pas un 5ᵉ écran) : ce qui s'est passé **pendant votre
absence** — déclarations des entreprises via QR (Fait/Bloqué + commentaire + photo).
« COLAS a déclaré : Regard 12 terminé · 📷 photo », « BatiSud signale un blocage ».
Un seul bouton : **Tout marquer comme vu**. Silencieux s'il n'y a rien de neuf
(c'est un filtre sur du frais, jamais un journal d'activité).

#### Réservoir de mémoire
En bas, deux chiffres bruts : interventions documentées et photos versées (votre capital mémoire).

### Interventions du jour (/aujourdhui)
Suit **en temps réel** ce qui se passe aujourd'hui. Quatre chiffres clés (Prévues / En cours / Terminées / À traiter), une résonance « ce que les lieux disent », un bloc **dette opérationnelle** (sans équipe aujourd'hui · passages en retard), un tableau **sous-traitants aujourd'hui** (Confirmé / Consulté / Non ouvert + qui relancer), et le **planning du jour** chronologique. Silence positif : ce qui est bon ne s'affiche pas.

### Briefing du soir (/briefing)
Consulté vers 18 h pour **préparer demain** : quatre chiffres (interventions prévues, équipes mobilisées, sites sans couverture, non-affectés), les **actions ouvertes à ne pas oublier** (clôturer / planifier), la couverture prévue par chantier, les personnes sans affectation, les **liens d'intervention** sécurisés `/i/[token]`, les contrats à renouveler, les anomalies non résolues, et la préparation des envois WhatsApp aux chefs d'équipe.

### Vue semaine (/semaine)
Couverture du lundi au dimanche. Deux perspectives : **Site × Jour** (chaque ligne un chantier ; heure de la 1ʳᵉ intervention, points ● par intervention, ambre discret si non-affecté) et **Équipe × Jour**. Un bandeau **Vigilance** remonte si des interventions sont sans équipe ou en chevauchement. Vous créez une intervention ponctuelle, exportez en Excel. Pour modifier une mission complète (récurrence, équipe titulaire), passez par **Missions**.

### Cockpit des actions (/actions)
Vue transverse de toutes les actions ouvertes, tous chantiers confondus. Une **action ≠ intervention** : c'est une tâche née d'une réunion, qui n'entre au planning que si vous la **planifiez**. Filtres par statut (ouvertes / planifiées / terminées) et par ancienneté (🔴 critique > 7 j · 🟠 à surveiller 3-7 j · 🟢 en rythme). Chaque action affiche son **type** (Ponctuelle / Pour une échéance / Récurrente jusqu'à clôture), sa **durée en clair** (« Ouverte depuis 143 j »), et l'**écho de la déclaration entreprise** si elle a répondu via QR. Deux gestes : **Clôturer** (commentaire + photo) ou **Planifier** (en intervention).

### Doctrine du cockpit
Pas de notation de personnes ; pas de wording alarmiste ; silence positif assumé ; contexte avant le nombre ; agrégats jamais des noms. Le cockpit répond à trois questions : qu'est-ce qui se passe, d'où ça vient, que dois-je faire.

---

## 4. Chantiers & mémoire du lieu

### Accueil des sites (/sites)
La liste de tous les chantiers, groupés par client. Sites actifs d'abord, sites inactifs (aucune trace depuis 6 mois) repliés. Un site avec des traces n'est **jamais supprimé** : il vieillit vers « Inactif » et reste consultable. Aucune donnée n'est perdue.

### Fiche chantier (/sites/[id])
En haut : identité (nom, client, région, statut) puis une rangée d'**accès rapides** : Journal · Livraisons · Points à lever · Sujets · Obligations · Dossier de preuve · QR Code · Atelier mémoire · **Exporter** (ZIP Excel + photos, admin/manager). Juste après, le bloc **« À savoir avant d'y aller »** (3 faits à transmettre + équipes qui connaissent le lieu + dernier intervenant).

#### Mémoire interrogeable
- **Sous-périmètres (scopes)** : découpage optionnel en sous-zones, pour mieux retrouver l'information (classement interne, jamais reporting).
- **Mémoire du lieu** : ligne de temps de toutes les traces (interventions, anomalies, photos, décisions) — qui était là, ce qui s'est passé, sans jugement.
- **Rythme d'activité** : calendrier en damier (14 j / 90 j) montrant l'intensité.
- **Équipes & photos** : qui a travaillé (14 j), galerie des photos récentes.
- **Continuité humaine** & **« le lieu vous rappelle »** : qui relancer, associations implicites.

### Points à lever / Réserves (/sites/[id]/reserves)
Une réserve = un point de non-conformité signalé, à corriger avant réception. Compte « N ouvert · N levé ». Chaque réserve est un **mini-dossier** : photo avant, photo après, date de levée, actions correctives liées, documents liés, commentaire. Export PDF en un clic. Vocabulaire « levée », jamais « résolu ».

### Bons de livraison (/sites/[id]/livraisons)
Chaque livraison enregistrée avec photo du BL, date/heure (opposable). Liste des fournisseurs triée par date. **Depuis le terrain** : sur la fiche site mobile (`/m/site/[siteId]`), le chef d'équipe peut **déclarer une livraison / évacuation** directement (fournisseur, produit, quantité, zone, note + **photo en un tap**) — utile quand un camion livre/évacue toute la journée. Tout remonte ici côté bureau.

### Journal du chantier (/sites/[id]/journal)
Historique jour par jour : entreprises présentes, équipes, anomalies, météo, photos du jour. Export PDF complet. **Météo automatique (Open-Meteo, sans clé)** : bouton **« Récupérer météo du jour »** qui renseigne pluie (mm), vent, températures et conditions dans le journal (cache par site/jour ; coordonnées du chantier demandées une seule fois, saisie manuelle ou localisation via l'adresse). La météo **documente** — elle ne coche jamais « intempérie » ni ne crée un blocage toute seule : si les conditions sont sévères, MemorIA *suggère* simplement de cocher « Journée empêchée ». Un **blocage de type intempérie** se relie automatiquement à la météo du jour et affiche « pluie 42 mm » dans la timeline.

### Blocages de chantier (mémoire de contexte)
Un **blocage** = un fait daté qui a empêché d'avancer : **intempéries, grève, accès, livraison, matériel, sous-traitant, administratif, sécurité, autre**. Ce n'est **pas du planning ni un Gantt** — c'est de la mémoire de contexte opposable (« le 12/07, terrassement reporté pour pluie »). Depuis la **Mémoire du lieu**, bouton **« Déclarer un blocage »** (type, ce qui a empêché d'avancer, impact, date) ; le blocage apparaît ensuite dans la ligne de temps en rouge, **« en cours »** tant qu'il n'est pas levé. Descriptif, jamais une imputation de retard à quelqu'un — on décrit le fait, on ne juge personne. Un blocage météo s'appuie sur la météo du jour déjà saisie (journal), il ne la recopie pas.

### Récit du chantier (/sites/[id]/recit)
**L'histoire du chantier**, pas un tableau. Accès rapide **« Récit »** en tête de fiche. Deux parties : (1) **« Raconte-moi ce chantier »** — une synthèse *déterministe* (démarrage, ancienneté, phase, sujet le plus actif, **jours de blocage cumulés + répartition par cause**, réserves levées) ; (2) la **frise mois par mois** des **jalons** lus comme un récit : 📝 réunion · ⛔ blocage · 🚚 livraison · 📋 réserve ouverte · ✅ réserve levée · 🧭 décision · ✔️ action terminée. C'est une **3ᵉ lecture** des mêmes données (le Journal montre le brut quotidien, la Mémoire du lieu les traces qui changent le lieu, le Récit les jalons). Aucune saisie, jamais un score ni une prédiction — « voici comment ce chantier s'est déroulé ».

### Sujets : l'histoire des problèmes (/sites/[id]/subjects)
Un **sujet** = l'histoire complète d'un problème ou livrable (DOE, essais, fissure…), jamais une personne. Recherche instantanée (« Taper DOE → tout »). Un indicateur de **santé de rattachement** montre le % d'objets reliés à un sujet (informatif, non bloquant).

La **fiche sujet** raconte : un **bloc Vigilance** en tête (⚠ « ouvert depuis 143 j · bloque la réception · engagement contractuel · obligation non satisfaite ») qui fait passer le sujet de *raconter* à *alerter* ; l'**état** (Bloqué / En attente / En sommeil / Ouvert / Clos) + ancienneté + énergie + cause probable (déterministe) ; un résumé « en 5 secondes » (état · depuis N j · cause · **dernière trace** · **sources** : d'où vient l'histoire · à faire) ; **synthèse vivante** (réunions, décisions, « récurrent », « échéance repoussée N fois ») ; **dépendances** (« ce sujet bloque N autres ») ; **historique chronologique** daté et situé à sa réunion ; **rattachements** à ajouter après coup.

**À l'échelle de l'organisation** : si le même sujet canonique existe sur d'autres chantiers, un bloc révèle le bilan cross-chantiers — *rencontré sur N chantiers · X % en retard · réserves · clôture moyenne · jours cumulés de retard*, ses **causes récurrentes** (« plans manquants (8) ») et les **facteurs de réussite observés** (« sur les réussites : obligation suivie 83 % vs 40 % sur les ratés »). Factuel, déterministe, jamais une prédiction — « voici ce qui revient quand ce sujet apparaît ».

### Obligations : ce qui DOIT exister (/sites/[id]/obligations)
Objet **prescriptif** : ce qui doit exister (DOE, journal photo, essais, PAQ…). MemorIA injecte au démarrage une **bibliothèque VRD curée**. Statut (À produire / En cours / Satisfaite / Non applicable), criticité (🔥/ambre/gris), santé **« négligée »** (l'entreprise n'a pas livré malgré relance) avec date de dernière relance. **Lier un document** : rattachez le CCTP/PAQ source + une **référence libre** (« chapitre 4.2, page 18 ») — MemorIA pointe le document, il ne le parse pas (aucune IA).

**Depuis les engagements de l'AO.** Si le chantier vient d'un appel d'offres converti, un bouton **« Transformer en obligations »** matérialise les engagements validés du contrat en obligations suivies, en conservant leur **origine contractuelle**. Chaque obligation issue d'un AO affiche alors **« ↳ origine : CCTP · p.148 »** — cliquable, qui ouvre le passage source (voir *Provenance navigable*). C'est le pont qui fait qu'une promesse écrite ne meurt pas dans le contrat : elle devient une obligation vivante reliée à son sujet.

### Dossier de preuve (/sites/[id]/preuves)
Vue consolidée : pour chaque action déclarée par une entreprise via QR, la chaîne **demande → entreprise → déclaration (Fait/Bloqué) → commentaire → photo → signature → validation MOE**. Rappel permanent : **la déclaration de l'entreprise et votre validation sont deux vérités distinctes** (une promesse vs une vérité de terrain). Lecture seule.

### QR Code du chantier (/sites/[id]/qr)
Un lien unique d'accès au journal **sans connexion**, imprimable. Générer / révoquer, historique des accès (date, device). Idéal pour consulter depuis le terrain.

> Doctrine : nulle notation de personnes, aucun alertage alarmiste. Un site, c'est la mémoire d'un lieu et de ses objets.

---

## 5. Réunions & compte-rendu de chantier

### Liste des réunions (/meetings)
Vos réunions de chantier ou de contrat, triées par date. Filtres (Toutes / Contrat / Site ; Actions ouvertes / Blocages). Statuts : **Analysé** (l'IA a proposé), **Validé** (curation close), **Échec** (vos données brutes restent sauvegardées). Chaque fiche affiche décisions, actions ouvertes, blocages.

### Fiche réunion (/meetings/[id])
Centralise tout :
- **Préparer cette réunion** : un briefing déterministe (ce qui traîne sur le chantier), zéro IA.
- **Santé de la mémoire** : couverture audio, état de la transcription. Vous ajoutez des audios de secours (mémo, débrief) fusionnés au corpus. Sur **chaque source** : **Réécouter** (lecteur intégré), **Relancer la transcription** (si elle est revenue vide ou a échoué) et **Supprimer** (un audio inaudible/raté, avec confirmation) — l'audio n'est jamais perdu, une erreur de transcription est toujours rattrapable.
- **Qui fait quoi, pour quand** : le panneau de curation des actions.
- **Blocages chantier** : à partir des dépendances/risques détectés dans la réunion, MemorIA **propose** « créer un blocage ? » (type pré-rempli) ; vous validez ou ignorez. Ajout manuel possible. Les blocages enregistrés ici remontent dans la Mémoire du lieu du chantier.
- **Compte-rendu** : un bouton vers l'écran de validation.

### Le panneau « Qui fait quoi, pour quand »
L'IA **propose** des actions ; vous **acceptez / modifiez / ignorez**. Chaque action validée porte : titre, responsable, échéance (badge « à confirmer » si estimée), **type** (Ponctuelle / Pour une échéance / Récurrente jusqu'à clôture), **narration de durée** (« Ouverte depuis 143 j »), et l'**écho** de la déclaration entreprise.

**Confier à une entreprise** : sélectionnez le destinataire (ex. Colas), les actions du lot, et pour chacune si une **photo de preuve est requise** (« montre-moi »). Vous générez un **QR + lien public** (à envoyer par WhatsApp). Le **statut du lot** affiche le parcours **Envoyé → Lu → Rempli**, le décompte Faites/Bloquées, et un bouton **révoquer**.

### Page publique entreprise (/a/[token])
Sans login : l'entreprise voit son nom, le chantier, **ses** actions. Pour chacune : **Fait** ou **Bloqué** (commentaire obligatoire si bloqué ; photo requise pour clôturer si demandée). Elle saisit son nom + une **signature** et envoie. Ses réponses remontent immédiatement dans MemorIA.

### L'écran de validation du PV (/meetings/[id]/pv/validation)
Le **hub** complet pour préparer et finaliser le compte-rendu, en un seul écran :
- **Parcours numéroté** ① Vérifier → ② Relire → ③ Corriger → ④ Générer → ⑤ Téléverser le final → ⑥ Figer la référence.
- **Gate de sévérité** : PV non finalisable / finalisable en mode urgent / prêt, score de confiance, points agrégés par type.
- **Points à confirmer** classés : 🔴 bloquants métier · 🔴 bloquants documentaires (PV urgent possible) · 🟠 importants · 🟢 suggestions. Gestes : Compléter (écrit la mémoire), Reporter, Ignorer, Faux positif.
- **Blocs éditables** : participants, casting du chantier (rôle→entreprise→contact), actions, décisions, remarques/ajouts, photos (couverture, ordre, légendes, exclusion).
- **Aperçu vivant** du CR à droite (le vrai PDF, rechargé à chaque modif).
- **⑤ Téléverser la version finale diffusée** = la **preuve** (conservée, jamais écrasée) ; **⑥ Figer la version générée** = la **référence** MemorIA (optionnelle, distincte de la preuve).

### Briefing de préparation (/meetings/[id]/briefing)
Sujets à surveiller + **détecteurs déterministes** (actions en retard, décisions non appliquées, acteur absent, réserves ouvertes, obligations négligées, congestion d'acteur, sujets récurrents, **actions récurrentes à reprendre**) + **questions à poser** dérivées. Zéro IA créative.

> Garde-fous : IA propose / vous validez ; données brutes conservées même si l'analyse échoue ; distribution = capter une déclaration, jamais gérer le travail ; décisions et sujets traversent les réunions suivantes.

---

## 6. Contrats, Missions, Équipes, Acteurs, Continuité

### Clients (/clients, /clients/[id])
Liste des clients (axe d'agrégation, sans métrique). La fiche client est structurée en **Aujourd'hui** (sites en rythme / à surveiller / critiques, anomalies, prochaine intervention), **Risques en cours**, **À faire cette semaine**, plus contact, mémoire client, sites, contrats, santé des sites (donut) et charge par site (barres). Chiffres factuels, jamais normatifs.

### Contrats (/contracts, /contracts/[id])
Inventaire (actif / pause / terminé / archivé) avec un **climat mémoriel** (Stable / Vigilance / Calme) qui remplace tout affichage de santé textuel. La fiche contrat est un **cockpit** : vitalité (objectif horaire, prestations documentées, échéance), documents, **continuité du service** (jours depuis démarrage, semaines sans rupture), **promesses du contrat** (chaque obligation avec ses ratios Planned/Executed/Proven/Validated, visuels seuls, jamais > 100 %). Sous-pages : missions, sites, interventions, rapport mensuel. Aucune comparaison inter-contrats.

### Missions (/missions)
Cockpit portfolio des missions récurrentes : à actionner (hors-rythme, anomalies, sans prochaine intervention, sans équipe), priorité n°1 mise en avant, anneau santé, missions par équipe (charge descriptive). Rouge = retard **réel** + anomalies, jamais manque théorique. Zéro scoring inter-équipes.

### Équipes (/equipes, /equipes/[id])
L'équipe est un **conteneur logistique**, jamais une unité d'évaluation. Liste : badge visuel, membres, référent, spécialités. La fiche : compteurs (sites, contrats, interventions, photos), rythme 14 j + densité 90 j, sites favoris, équipes voisines (back-up), composition, activité récente. **Zéro métrique de performance, zéro classement.**

### Intervenants (/intervenants, /intervenants/[id])
Vue **descriptive**, tri alphabétique, **chaque consultation tracée** (audit log). La fiche intervenant (admin/manager, auto-exclu) : identité, compteurs (interventions, sites connus, traces laissées), rythme, historique équipes (2 ans), « a travaillé avec », présence lors d'incidents, interventions récentes. Wording strictement descriptif, **pas de score, pas de comparaison côte à côte**. Actions : parcours de fin de contrat, générer un passage de témoin.

### Passages de témoin (/handovers, /handovers/[id], /h/[token])
Centre de **continuité opérationnelle** : radar des fins de contrat proches, mémoire transmise ce mois (volume, jamais un score), timeline des passations, « à savoir » en cours, briefs par statut (À transmettre / Partagé / Reconnu / Archivé). Le **brief** porte sur la **mémoire du lieu, jamais la personne qui part** : à savoir, anomalies, documents, équipes relais (payload immuable). Partage par **lien public `/h/[token]`** (mobile-first, « C'est lu, j'ai compris », PDF imprimable). La page **/continuite** redirige ici.

> Doctrine transversale : jamais de notation de personnes ; cockpit (lire en 3-10 s), pas rapport ; volume ≠ performance ; wording opérationnel (« à surveiller » ≠ « mauvais »).

---

## 7. Recherche, Dossiers de démarrage, Bibliothèque, Glossaire, Preuves, Outils

### Recherche — mémoire transverse (/recherche)
Une barre unique interroge tous vos chantiers en temps réel : notes terrain, missions, anomalies, sous-traitants. Chaque résultat (carte cliquable) restitue le site, la date, le statut, l'équipe, les photos, les anomalies, les entreprises, un extrait, et les **sources du match**. Au moins 2 caractères pour déclencher. Admin/manager.

### Interroger l'entreprise (/memoire)
Posez une question libre (« problèmes de ferraillage depuis 3 mois ? ») : MemorIA fouille toute la mémoire et restitue les traces par site, avec synthèse à la demande. Admin/manager.

### Dossiers de démarrage — AO (/tenders, /tenders/[id])
Importez le **PDF** d'un cahier des charges ; MemorIA en extrait **contraintes, risques, checklist**, rédige une **mémoire technique** ancrée sur votre bibliothèque, et calcule un **score d'opportunité**. Statuts : Brouillon → Extraction → **Analyse** (avec **barre de progression**) → Prêt / Échec → Soumis / Archivé.

La fiche AO offre 4 vues : **Synthèse** (résumé, risques, contraintes, score, capital client, sources documentaires cliquables `[doc:id]`), **Analyse détaillée**, **Mémoire technique** (+ terrain matching avec vos interventions réelles), et **Atelier IA** (plusieurs agents experts, conversation multi-tours, accessible même pendant une relance). Si l'analyse échoue, un message précis s'affiche et vous pouvez **relancer**.

> L'analyse tourne désormais de façon fiable (dans la requête, avec garde-temps) et l'IA cite ses sources ; elle ne prétend jamais conclure sans preuve documentaire.

#### Engagements (/tenders/[id]/engagements)
Au-delà de l'analyse, MemorIA extrait les **engagements** du dossier — les clauses
prescriptives que vous devrez tenir. Chacun est **typé** (Objectif / Obligation /
Livrable / Contrôle / Pénalité) et **regroupé** par nature (ou par thème). Vous **curez**
(valider / éditer / rejeter, fixer l'exigence de preuve et la destination) ; le type
pré-remplit des défauts sensés (un contrôle attend une photo, une pénalité part en
vigilance). Un encart **« Ce que dit votre expérience »** confronte chaque exigence à
l'historique de vos chantiers (sujet canonique) : *« DOE — rencontré sur 5 chantiers ·
44 % en retard · causes : plans manquants (8) »*. Factuel, jamais une prédiction.
Une fois l'AO gagné, le **wizard de conversion** (`/tenders/[id]/convert`) crée le contrat,
et les engagements deviennent des **obligations** sur le chantier (voir §4 Obligations).

#### Provenance navigable & audit documentaire
« L'IA n'invente rien » : chaque engagement garde son **extrait verbatim** et sa
**localisation**, avec **trois niveaux de confiance** — *Citation exacte* (page fiable →
bouton « ouvrir la page »), *Section connue* (chapitre, pas de page → « ouvrir le
document »), *Référence approximative* (concept identifié sans localisation fiable →
**aucun bouton page**, l'extrait reste la trace). **Jamais de fausse page.** Pour vérifier,
la page « source » montre l'**extrait** d'abord (le passage, pas le PDF de 300 pages),
son **paragraphe complet**, et les **autres occurrences** du terme dans le document
(« aussi mentionné : p.4 · p.9 »). L'**Audit documentaire** (`/tenders/[id]/audit`) ouvre
le PDF complet face à la liste navigable de tous les engagements.

#### Promotion depuis l'Atelier IA
Dans l'Atelier, sous chaque réponse d'agent, un bouton **« Transformer en engagement »** :
une réflexion utile (« le nettoyage des hottes semble absent du CCTP ») devient un
engagement suivi, que vous typez. La réflexion ne se perd plus — elle rejoint le même
fil que les engagements extraits.

### Bibliothèque — capital IA (/library)
Le capital de connaissance de votre entreprise (références, moyens, procédures, qualité). Plus elle est riche, plus l'analyse des AO est précise. Hero de synthèse (top ressources citées ce mois), filtres (catégorie, tags), ajout en un clic.

### Bibliothèque documentaire (/documents, /documents/[id], /documents/import)
Organisation vivante de vos documents : collections (drag-and-drop), statut d'indexation, **couche mémoire** (Vivante / Consultable / Froide). La fiche document montre métadonnées, rattachements (contrat/site/client), continuité documentaire (remplace / remplacé par), aperçu inline + téléchargement. Import par lot avec triage et coût indicatif **avant** de lancer.

### Glossaire métier (/glossaire — **administrateur**)
Le vocabulaire de votre métier (finisseur, grader, grave-bitume, PAQ, DOE…) : **terme / définition / alias / catégorie**. Les **alias sont corrigés automatiquement** dans les transcriptions des prochaines réunions (« finisher » → « finisseur ») — remplacement exact, **aucune IA**. C'est un **référentiel de configuration**, rangé sous **Administration** dans le menu. Un bouton **« Charger le vocabulaire métier »** installe en un clic un socle de démarrage **multi-métier** avec ses fautes fréquentes : **VRD/MOE** (DOE, DGD, GPA, PAQ, OPR, PV, CR, MOE/MOA, finisseur, niveleuse, grave-bitume, enrobé, terrassement, réception, levée de réserves…), **propreté** (autolaveuse, monobrosse, bionettoyage, décapage…), **électricité** (TGBT, CFO/CFA, GTB, consignation, Consuel…), **CVC/plomberie** (VMC, CTA, ECS, PAC, désembouage…) et **sécurité incendie** (SSI, SDI, CMSI, DAS, désenfumage, coupe-feu…). C'est **idempotent** (n'écrase rien, ajoute seulement ce qui manque), à adapter ensuite.

### Dossier de preuves (/preuves, /preuves/[id])
Retrouvez instantanément vos preuves d'intervention (filtre par site / statut / période). La fiche génère un **PDF horodaté** (photos, checklist, validations, anomalies, QR de vérification) et un **lien public temporaire** anonymisé (commentaires des visiteurs enregistrés). Anonymisation stricte (aucun prénom d'agent), wording neutre (« faits constatés »).

### Litige (/litige)
Un assistant guidé en 4 étapes (site → période → types de preuves → générer) qui produit un **dossier de défense** PDF horodaté. Wording strictement descriptif, mono-tâche.

### Mode simplifié (barre latérale)
Le bouton **« Mode simplifié »** réduit la navigation aux 5 essentiels (Recherche, Tableau de bord, Réunions, Actions, Sites) et masque le reste. Persisté par appareil, réversible (« Tout afficher »). Aucune donnée n'est supprimée — tout reste accessible par URL.

---

## 8. Les liens & QR Codes (sans login) — qui sert à quoi

MemorIA génère plusieurs **liens publics** (QR Code ou lien à coller dans WhatsApp). Ils se
ressemblent (mobile, sans compte) mais **ne servent pas à la même chose**. La bonne grille de
lecture n'est pas « c'est un QR » : c'est **dans quel sens circule l'information** et **quel
périmètre** est exposé. Deux familles :

**🟦 Les liens qui MONTRENT (sortant — lecture seule).** Vous communiquez vers l'extérieur.

- **QR Code du chantier** (`/qr/[token]`) — affiché **sur le chantier**. Quiconque scanne voit
  le **journal complet** du site (interventions, photos, anomalies), en lecture seule. C'est la
  **vitrine de transparence** (client, maître d'ouvrage, riverain). Aucune action possible.
- **Passage de témoin** (`/h/[token]`) — le brief de relève envoyé au chef qui prend la suite ;
  il lit et confirme « C'est lu ».
- **Preuve / rapport mensuel** (`/p/[token]`) — envoyé au **client** : il voit la preuve
  (anonymisée) et télécharge le PDF. C'est aussi la cible du QR imprimé sur les PDF.
- **Attestation d'authenticité** (`/v/[token]`) — QR sur un PDF archivé : des années plus tard,
  atteste juste « ce document a bien été émis par X le … ». Aucun contenu.
- **Capsule** (`/c/[token]`) — un coup d'œil de 12 s (1 photo + 1 phrase) pour un client.

**🟧 Les liens qui RÉCOLTENT (entrant — l'entreprise vous répond).** Une entreprise externe
vous renvoie l'état d'un travail, avec photo.

- **QR intervention** (`/i/[token]`) — confié à un sous-traitant pour **une mission planifiée
  précise** : il voit **cette intervention et sa checklist**, et la valide. *Usage type :
  propreté / interventions récurrentes.*
- **QR actions** (`/a/[token]`) — confié à **une entreprise pour un lot d'actions** issues d'une
  **réunion de chantier** (« qui fait quoi ») : elle déclare chaque action **Fait / Bloqué** (+
  commentaire, photo, signature). *Usage type : MOE / suivi de réunion (BECIB).* Voir aussi
  §5 « Confier à une entreprise » et §4 « Dossier de preuve ».

> **Pourquoi deux liens « entrants » et pas un seul ?** Parce qu'ils partent de deux objets
> différents : une **intervention planifiée** (mission datée + checklist) ≠ des **actions de
> réunion** (engagements transverses, regroupés par entreprise). Tant qu'une même entreprise ne
> reçoit pas les deux en même temps, ils ne se marchent pas dessus. Si ce cas se présente sur le
> terrain, ils seront **fusionnés en une seule page de déclaration** — pas avant que l'usage réel
> le demande.

> **Règle de sécurité commune à tous.** Chaque lien est **révocable** et peut **expirer** ; les
> accès sont **tracés** (sans cookie ni pisteur tiers). Une **déclaration d'entreprise n'est pas
> une vérité de terrain** : votre validation reste la vôtre. Les liens « preuve » sont
> **anonymisés** (aucun prénom d'agent).

---

> **Garde-fous transversaux.** Anonymisation (aucun prénom d'agent dans les
> preuves/exports). Sobriété (ambre pour signaler, jamais de rouge dramatisant ;
> « faits constatés » plutôt qu'« incidents »). Accès par rôle (recherche,
> documents, AO, preuves, glossaire, litige = admin/manager ; chefs d'équipe =
> espace terrain). Audit & continuité (temps mémoriel explicite, supersession
> visible, accès tracés). **La mémoire d'abord, jamais la notation des personnes.**
