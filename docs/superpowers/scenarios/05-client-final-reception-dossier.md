# Scénario 5 — Sylvie / Réception du dossier de preuves

**Date** : 2026-05-13
**Persona** : Sylvie Robineau, 49 ans, resp. hygiène hôpital Magenta
**Job-to-be-done** : Évaluer si je peux faire confiance au document que vient de m'envoyer mon prestataire
**Méthode** : 1 scénario = 1 agent d'analyse

---

## 1. Scénario réel détaillé — les 90 premières secondes

Mardi 14 mai, 10h47. Sylvie est sur Outlook, écran double, 11 onglets Chrome, café froid à côté du clavier. Le mail de Patrick arrive et sort du flot parce qu'il est court — quatre lignes. Elle le lit en deux secondes. Le mot qui accroche, c'est « salle 312 ». C'est l'incident remonté il y a dix jours par l'infirmière chef du service oncologie qui a trouvé un chariot mal essuyé. Sylvie a écrit à Patrick le 6 mai, sec, en mode « merci de me confirmer que ça ne se reproduira pas ». Patrick lui répond avec un lien, dix jours après. Bon point ou mauvais point ? Elle ne sait pas encore.

Elle clique. Le lien s'ouvre dans un nouvel onglet. Premier réflexe oculaire : elle scanne le haut de la page. Elle voit « NETOIAGE ». Elle ne connaît pas. Elle voit « Document factuel anonymisé · Vérifiable via QR code » en petits caractères gris. Elle voit le titre « Nettoyage chambre 312 — service oncologie » et la date « Exécutée le 6 mai 2026 ». Elle voit le nom de son site, son numéro de contrat. C'est bien le sien.

Dans les trois premières secondes, son cerveau fait trois choses :
1. **Authentification visuelle** : « C'est bien à propos de la salle 312, c'est bien mon contrat, c'est bien mon site. Donc Patrick ne m'a pas envoyé un truc générique. »
2. **Évaluation d'autorité** : « Qu'est-ce que c'est que cet outil ? Patrick s'est payé une plateforme ? Ou c'est un truc bricolé ? »
3. **Évaluation d'effort** : « Combien de temps je vais y passer ? J'ai un comité qualité à 11h30. »

Elle compare instantanément à ce qu'elle recevait avant. Avant, c'était un PDF Word avec le logo couleur de l'entreprise de Patrick en haut, une signature scannée de Patrick en bas, deux ou trois photos jointes en pièces séparées dans le mail. C'était moche mais c'était **incarné** — c'était Patrick. Là, c'est plus propre, plus moderne, plus pro… mais c'est aussi plus froid. Plus anonyme. Moins « Patrick ».

Elle scrolle. Vite. Elle ne lit pas les sections une par une. Elle survole pour repérer trois choses : (a) les photos, (b) le mot « anomalie » s'il existe, (c) ce qui se passe en bas. Elle voit la grille de photos. Elle agrandit la première, voit le timestamp « Capturée le 6 mai à 14:23 ». Elle hoche la tête. Elle voit les anomalies — celle de la salle 312 est listée, « résolue » avec date. Elle scrolle jusqu'en bas, voit « Lien valable jusqu'au 21 mai 2026 ». Première friction sérieuse.

Elle imprime ? Non, pas tout de suite. Elle clique « Télécharger le PDF ». Le PDF s'ouvre. Elle survole, fait Cmd+S, le glisse dans `~/Magenta/Qualité/2026/Mai/Cleaning/`. Maintenant elle se sent un peu mieux : elle a une copie locale. Elle ferme l'onglet. Total : 1 minute 50.

Elle ne reviendra probablement plus sur le lien. Le PDF est devenu la version de référence dans son archive.

## 2. Ce que Sylvie ressent

**Méfiance professionnelle de base.** Pas dirigée contre Patrick, dirigée contre la situation. Elle a 49 ans, 25 ans dans la fonction publique hospitalière. Elle sait qu'un prestataire qui produit ses propres preuves de son propre incident est dans une position délicate. Le document est intéressé par construction.

**Soulagement discret quand le rendu est propre.** Elle s'attendait à un PDF Word brouillon. C'est mieux que ça. Le mot « NETOIAGE » l'intrigue mais ne l'effraie pas — ça ressemble à un outil métier, pas à un site bricolé. Elle pense « ah, ils ont investi ».

**Irritation potentielle sur l'anonymisation.** Quand elle voit « Équipe terrain · 3 personnes », elle bloque trois secondes. Elle voulait savoir qui était là. Pas pour blâmer, mais parce que sa cadre supérieure va lui demander en réunion à 11h30 : *« C'est qui qui a fait la chambre 312 ce jour-là ? »* Et là, Sylvie n'aura pas la réponse. Elle est gênée à l'avance.

**Fatigue managériale.** Elle gère sept prestataires. Si chacun se met à lui envoyer des liens dans une plateforme différente, sa vie devient invivable. Mentalement, elle commence à se demander si elle ne va pas dire à Patrick : « envoie-moi juste le PDF, je n'ouvrirai plus le lien ».

**Ce qu'elle dit à Marie-Claire à côté** (sa collègue chargée du marché restauration) : *« Patrick m'a envoyé un truc bien plus clean que d'habitude pour la 312. Avec des photos horodatées et tout. Bon, ça reste lui qui te dit qu'il a bien nettoyé sa propre chambre, hein. Mais c'est mieux fichu. »* Marie-Claire répond *« Tu vas le garder ou tu mets en concurrence ? »* Sylvie : *« Je verrai. Au moins j'ai un truc à montrer en réunion. »*

## 3. Ce qu'elle cherche vraiment

Elle ne cherche **pas** un rapport. Elle cherche trois choses, dans cet ordre :

**(a) La preuve que Patrick prend l'incident au sérieux.** Le fait qu'il existe un document structuré, daté, avec photos, est en soi le signal. Le contenu compte moins que l'existence. Si Patrick avait répondu par mail « c'est résolu, à plus », c'était mort. Le simple fait qu'il y ait un objet artefactuel — un truc qu'on peut télécharger, classer, montrer — change la dynamique.

**(b) Un objet qu'elle peut présenter à sa direction.** Quand la directrice générale adjointe va lui dire en comité qualité « est-ce qu'on a un suivi sur l'incident 312 ? », Sylvie veut pouvoir dire « oui, voici ». Le PDF imprimé sur la table, c'est le but. Pas la conversation. Pas l'analyse. **L'objet de défense managériale.**

**(c) La signature que ce n'est pas inventé.** Et c'est là que MemorIA a quelque chose d'unique. Les horodatages serveurs des photos, le QR de vérification, le fait que le lien soit hébergé ailleurs que sur le Drive de Patrick — tout ça envoie le signal *« ce n'est pas un document que Patrick a tapé hier soir dans Word ».* Sylvie ne va pas faire le test du QR. Mais le fait qu'il existe la rassure.

**Ce qu'elle cherche, c'est de l'autorité, pas du contenu.** Le contenu, elle ne le lit pas en détail. L'autorité, elle la perçoit en trois secondes.

## 4. Où MemorIA aide

**Les photos horodatées.** Mention serveur « Capturée le 6 mai à 14:23 ». Crédible. Difficile à falsifier en post-prod. C'est exactement le type d'élément qu'elle peut citer en comité : *« Voici les photos avec horodatage serveur. »*

**Le QR code de vérification.** Personne ne le scannera. Mais sa simple présence dit « ce document est vérifiable ». C'est un **signal d'autorité**, pas un outil. Comme un cachet sec sur un acte notarié.

**L'absence totale de marketing.** Pas de « cher client, nous sommes ravis de vous présenter ». Pas de score qualité. Pas de « semaine remarquable ». Le ton sobre est crédibilisant. Sylvie a vu trop de rapports HubSpot enrobés ; celui-ci sent le métier.

**Le wording neutre.** « Anomalies signalées » (pas « incident isolé »), « résolue » (pas « brillamment résolue »). Le manque d'adjectifs est en soi une signature de sérieux.

**L'externalisation visuelle sur un autre domaine.** Le lien n'est pas `cleaning-patrick.nc/preuves/312`, c'est un domaine tiers. Sylvie ne le verbalise pas mais son inconscient le note : un tiers de confiance est dans la boucle.

**Le PDF téléchargeable.** Capital. Elle peut le glisser dans son archive locale, l'imprimer, le forwarder. Le PDF est son **mode de survie managériale**.

## 5. Où MemorIA échoue

**1. Le branding « MemorIA » est neutre, pas autoritaire.** Sylvie ne connaît pas. Ce n'est pas une signature de confiance comme « Bureau Veritas » ou « Apave ». Le mot est même un peu bizarre — elle hésite sur la prononciation. *Effet* : elle ne tire pas de crédibilité du nom de domaine. Le document apparaît comme « émis par un outil que Patrick a choisi », pas « audité par un tiers ».

**2. Le lien temporaire 7 jours est suspect.** Sylvie tique. *« Pourquoi ça expire ? Patrick essaie de pouvoir dire dans six mois que le document n'existait pas ? »* C'est paranoïaque mais c'est ce qui se passe dans la tête d'une responsable qualité hospitalière. L'expiration est conçue pour la sécurité (anti-leak), mais elle est lue comme une **fragilité juridique**. Elle se précipite pour télécharger.

**3. L'anonymisation « équipe terrain · 3 personnes » crée une frustration.** Sylvie veut savoir qui. Pas pour punir. Pour répondre à sa hiérarchie. Pour fermer la conversation. La doctrine V3 refuse d'exposer les identités par défaut — pour des raisons valables — mais Sylvie n'a pas accès au contexte doctrinal. Pour elle, c'est juste *« l'outil cache des choses »*. Tension réelle entre la protection des agents et la lisibilité managériale.

**4. Pas de signature humaine.** Le PDF n'a pas de signature scannée de Patrick. Pas de cachet d'entreprise. Pas de « Bien à toi, Patrick, DG de NetCal ». Le document est **désincarné**. Pour Sylvie qui apprécie Patrick depuis 4 ans, le document semble venir d'une machine — alors qu'elle voulait Patrick. Le rapport mensuel a la note DG ; le dossier d'incident, lui, n'a rien d'équivalent. Trou flagrant.

**5. Pas de logo client de Patrick.** L'entreprise de Patrick, « NetCal », n'apparaît qu'en sous-titre minuscule (« tenantName · Dossier de preuves »). Pour Sylvie, le document **n'est pas émis par Patrick** — il est émis par MemorIA. Inversion de la relation. Sylvie n'est pas cliente de MemorIA, elle est cliente de NetCal.

**6. Le QR de vérification est inutile en pratique.** Personne ne sort son téléphone pour vérifier un QR sur un PDF dans une réunion. Il fait office d'amulette, c'est tout. *Limite* : ce n'est pas un échec, c'est un coût pédagogique — le QR pourrait être remplacé par une URL courte lisible en clair (« Vérifiez ce document : memoria.app/v/AB3X »).

**7. Pas de téléchargement permanent sécurisé.** Une fois le lien expiré (21 mai), si Sylvie a perdu son PDF, elle dépend de Patrick pour relancer un nouveau lien. Pour son **archive qualité hôpital** qui doit être conservée 5 ans par réglementation HAS, c'est gênant. Elle aimerait un PDF avec une URL stable de vérification qui survit à l'expiration du lien éphémère.

**8. Aucune réponse possible côté Sylvie.** Elle voudrait dire « j'ai bien reçu » ou « pourrais-tu compléter avec X ». Aujourd'hui, elle doit retourner sur Outlook, écrire un mail à Patrick. Friction. Le lien MemorIA l'a fait sortir de son flux mail pour rien — elle y retourne.

**9. Pas de visibilité sur les éventuels autres dossiers d'incident.** Si Sylvie veut vérifier qu'il n'y a pas eu d'autres incidents non remontés, elle ne peut pas. Le lien est un silo. Elle aimerait, sans avoir besoin d'un compte, voir « combien de dossiers de preuves NetCal m'a partagés ce trimestre ». Mais ça ouvre la porte à un portail client — dérive d'architecture identifiée plus bas.

**10. La preuve d'envoi n'est pas certifiée.** Patrick peut prétendre qu'il a envoyé le 14 mai. Sylvie n'a que son mail Outlook comme preuve. Si litige, elle voudrait un horodatage signé du « partage du lien » indépendant de la boîte Outlook de Patrick.

## 6. Dépendances externes — MemorIA n'absorbe rien

Ce que Sylvie va réellement faire avec le document :

- **Télécharger le PDF** dans son archive locale `~/Magenta/Qualité/2026/Mai/Cleaning/`
- **Imprimer** une copie pour son classeur physique « Comité qualité mai »
- **Forwarder le mail** original de Patrick à la directrice générale adjointe avec un commentaire de deux lignes
- **Mentionner en réunion** à 11h30 (oral, pas de slide dédié) sous forme « *l'incident 312 a été documenté, dossier disponible* »
- Éventuellement **forwarder le lien** (pas le PDF) à l'infirmière chef qui avait remonté, comme courtoisie

MemorIA doit **cohabiter** avec : Outlook (transport), imprimante (archive physique), arborescence locale (archive numérique), réunion orale (présentation), forwarding (transmission interne). **Ne jamais vouloir absorber ces flux.** Le lien MemorIA est un **point de vérité**, pas un canal de communication.

## 7. Risques doctrinaux — pressions futures

Sylvie, sous trois mois de pratique, va envoyer des demandes à Patrick (qui les remontera à MemorIA). Chaque demande doit avoir une réponse doctrinale **préparée**.

| Demande probable | Risque doctrinal | Réponse |
|---|---|---|
| « Patrick, fais en sorte que ton outil m'envoie le rapport direct par mail le 5 du mois » | Devenir émetteur à la place du prestataire | ❌ Refus. Patrick reste l'expéditeur. MemorIA ne mail jamais le client final. Sinon MemorIA devient l'interlocuteur. Dérive vers SaaS B2B2C — le client se fidélise à la plateforme, pas au prestataire. |
| « Je veux commenter directement sur le document » | Portail client = grosse dérive | ❌ Refus. Pas de commentaires inline. Sylvie répond à Patrick par mail. MemorIA n'est pas une messagerie. |
| « Je veux voir l'historique cumulé de tous les rapports de Patrick » | Portail client permanent avec login | ❌ Refus. Un lien = un document. Si Sylvie veut un historique, elle doit demander à Patrick (le prestataire reste l'interlocuteur). Si on cède : MemorIA devient un mini-portail, le moat de « scope assumé » s'effrite. |
| « Je veux voir les noms des agents qui ont fait la 312 » | Doctrine V3 anonymisation | ⚠️ Tension. Réponse : un override `include_identities` existe **côté Patrick** (audit + justification écrite). Patrick peut le faire à la demande, ponctuellement, pour un dossier juridique. Mais ce n'est **pas** un mode par défaut, et ce n'est **pas** une décision de Sylvie. Le prestataire reste maître de l'exposition. |
| « Je veux noter Patrick » | Rating = mesure individuelle | ❌ Refus net. MemorIA ne fera **jamais** de système de note client. Glissement immédiat vers KPI fournisseur, comparaison, classement. C'est la fin du produit. Sylvie a Excel pour ça. |
| « Patrick voit que j'ai ouvert le lien à 10h53 » | Tracking client | ❌ Refus. Le compteur `access_count` interne audit ne doit **jamais** remonter en granularité « date d'ouverture » à Patrick. Patrick voit « consulté oui/non » à la rigueur. Pas plus. Le client final n'est pas surveillé. |
| « MemorIA envoie un mail à Sylvie automatiquement le 5 du mois » | MemorIA devient l'auteur | ❌ Refus. Patrick reste celui qui clique « envoyer ». Pas d'automatisation transparente. Le rapport mensuel doit avoir un instant humain de validation. |
| « Je veux une API pour intégrer MemorIA à mon ERP hospitalier » | Dérive plateforme | ❌ Refus. Export PDF + ICS suffit. Pas d'API client. Si l'hôpital veut intégrer, il scrape le PDF côté ERP. MemorIA n'est pas un fournisseur de données structurées pour SI tiers. |
| « Sylvie demande à recevoir une alerte SMS dès qu'une anomalie est résolue sur son site » | Notification client | ❌ Refus. Pas de canal direct MemorIA → client final. Tout passe par Patrick. |
| « Sylvie veut télécharger un export Excel des interventions du trimestre » | Reverse-engineering KPI | ⚠️ Si export, **anonymisé**, sans noms, sans durées calculées par agent. Mieux : refuser et rediriger vers Patrick qui peut générer un récap. |

**Principe transversal** : *Sylvie consulte. Sylvie n'opère pas. MemorIA est le canal de Patrick vers Sylvie, jamais le serviteur de Sylvie.*

## 8. Solutions possibles — rendre le document AUTORITAIRE

Trois axes d'amélioration UX, tous compatibles avec la doctrine, qui transformeraient la perception « ah un outil interne » en « ah un document officiel » :

**Co-branding sobre prestataire + plateforme.** En haut du PDF et de la page web : « *Document émis par NetCal · Plateforme de preuves MemorIA* ». Logo de l'entreprise Patrick (NetCal) à gauche, marque MemorIA à droite, séparateur fin. Permet à Sylvie de reconnaître Patrick instantanément, tout en gardant la signature de tiers. **Sylvie est cliente de NetCal, pas de MemorIA** — l'UI doit refléter ça.

**Lettre d'accompagnement DG (optionnelle, courte).** Pour un dossier d'incident comme la salle 312, Patrick devrait pouvoir attacher 3-6 lignes signées en haut du document : *« Madame Robineau, je vous adresse ce dossier suite à l'incident remonté le 6 mai. Le dossier détaille les preuves de la prestation et les mesures prises. Patrick X. »* Pas une note IA, pas un template — un champ libre validé à l'envoi, comme la note DG du rapport mensuel. **Incarne le document.**

**URL stable de vérification + lien éphémère séparés.** Aujourd'hui, le lien `/p/[token]` est à la fois la consultation ET la vérification, et il expire. Séparer : (a) le **lien de consultation** éphémère (sécurité, 7 jours) que Patrick partage à Sylvie, (b) une **URL stable de vérification** imprimée sur le PDF qui ne fait que confirmer « ce document existe, voici son hash, voici sa date d'émission ». Sylvie peut faire vérifier le PDF 3 ans plus tard sans dépendre de Patrick. Tier vérification anonyme, pas de données revealed, juste un check d'intégrité.

**Watermark + URL lisible en clair.** Sur chaque page du PDF, en pied : « *Vérifiable : memoria.app/v/X9K2-AB3F* ». Plus utile que le QR pour un humain en réunion. Le QR reste pour les auditeurs qui scannent depuis un bureau.

**Signature cryptographique du PDF.** Le PDF est signé numériquement par MemorIA au moment de la génération. Adobe Reader affiche un bandeau « ce document est signé et n'a pas été modifié ». Sylvie ne verra peut-être pas, mais ça vaut pour les auditeurs. Coût technique faible (PAdES).

**Bouton « Archiver dans mon ordinateur » plus visible.** Aujourd'hui, c'est un lien hypertexte vers `/p/[token]/pdf`. Mettre un bouton primaire « Télécharger pour archiver » avec un sous-texte « *Le PDF reste valide même après expiration du lien* ». Rassure Sylvie sur son archivage qualité.

**Date d'expiration reformulée.** Au lieu de « *Lien valable jusqu'au 21 mai 2026* » (qui sonne fragile), reformuler : « *Téléchargez le PDF pour archivage permanent. Le lien web reste actif 7 jours.* » Inverser le message : le PDF est permanent, le lien web est temporaire pour sécurité.

## 9. Solutions refusées (et pourquoi)

- **Portail client avec login** → grosse dérive d'architecture. Devient une plateforme B2B2C. Refus immédiat. Patrick reste l'interlocuteur unique de Sylvie.
- **Système de commentaires inline** → Pandora. Une fois ouvert, on doit gérer notifications, threads, mentions, mod. Refus net. Sylvie répond par mail.
- **Note / rating de la prestation par Sylvie** → glissement immédiat vers KPI fournisseur, comparaison de Patrick avec d'autres prestataires MemorIA. Refus net, irréversible.
- **Tracking de Sylvie côté Patrick** (« Patrick voit que Sylvie a ouvert à 10h53, a passé 1m50, n'est jamais revenue ») → Sylvie est cliente, pas suspecte. Refus net. Audit interne anonymisé OK ; remontée granulaire à Patrick non.
- **Forwarding automatique à la direction de Sylvie** → Sylvie reste maître de la communication interne. MemorIA n'envoie pas de mail.
- **Réponse intégrée « commenter le dossier »** → friction d'UX, dérive vers chat client. Refus.
- **Compteur public « Patrick a partagé 47 dossiers ce trimestre »** → faux signal d'autorité, et premier pas vers la mesure du prestataire par le client. Refus.
- **Tableau de bord client avec tous les rapports passés** → portail B2B2C, refus net.

## 10. Recommandations priorisées

**Reco #1 — Co-branding sobre prestataire + plateforme dans l'en-tête.**
*Effet* : Sylvie reconnaît Patrick immédiatement, le document n'est plus « émis par MemorIA » mais « émis par NetCal via MemorIA ». Restaure la relation commerciale réelle. Augmente le sentiment d'autorité sans verser dans le marketing.
*Effort* : faible (1-2 jours). Champ `tenant.logo_url` + render dans le header PDF et la page publique.
*Garde-fou doctrinal* : logo prestataire reste sobre (taille modeste), pas de slogan, pas de couleurs envahissantes. La marque MemorIA reste visible comme signature de tiers.

**Reco #2 — Lettre d'accompagnement DG sur les dossiers d'incident.**
*Effet* : incarne le document. Sylvie sent que Patrick est derrière. Bascule la perception de « machine » vers « Patrick avec un outil pro ». C'est l'antidote le plus direct à la critique #4 (« pas de signature humaine »).
*Effort* : moyen (3-5 jours). Champ texte libre, validation à l'envoi, watermark visuel pour dire « note ajoutée par le DG, pas générée ». Réutilise le pattern de la note DG du rapport mensuel (Chantier E déjà existant).
*Garde-fou doctrinal* : pas de template suggéré, pas d'IA pour aider à rédiger, pas de placeholder marketing. Champ libre, optionnel, factuel. Limite caractères raisonnable (500-800).

**Reco #3 — URL stable de vérification gravée dans le PDF, indépendante du lien éphémère.**
*Effet* : Sylvie peut archiver le PDF pour 5 ans (obligation HAS) et faire vérifier l'intégrité même après expiration. Résout la critique #2 (lien temporaire suspect) et la critique #7 (pas de téléchargement permanent). Signal d'autorité majeur : le PDF a une **identité pérenne**.
*Effort* : moyen-fort (5-8 jours). Route publique `/v/[hash]` qui ne fait que confirmer « ce hash de PDF a été émis par MemorIA le X par tenant Y ». Pas de données preuve revealed, juste un certificat d'intégrité. Décorréler de la table `share_tokens`.
*Garde-fou doctrinal* : la route `/v/[hash]` ne révèle **aucune donnée** sur la preuve elle-même. Pas de photos, pas de site, pas d'identités. Juste « ce document existe, voici son hash signé, voici sa date d'émission ». Vérification d'authenticité, pas exposition de contenu.

---

## Tension centrale

Cette tension entre **doctrine d'anonymisation** (qui protège Patrick et ses agents) et **autorité perçue** (qui sert l'archivage défensif de Sylvie) est le nœud du scénario. Le réflexe naïf serait de céder sur l'anonymisation pour « rassurer le client ». **Refus.** L'anonymisation est le moat. La bonne réponse est d'**augmenter l'autorité par d'autres canaux** : co-branding, lettre DG incarnée, URL stable de vérification, signature cryptographique. La perception d'autorité ne passe pas par « voir les noms » — elle passe par « sentir qu'un humain pro est derrière, et qu'un tiers garantit l'intégrité ». Tous les leviers de la section 8 vont dans ce sens.
