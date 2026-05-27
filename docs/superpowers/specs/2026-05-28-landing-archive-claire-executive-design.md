# Landing MemorIA - Archive claire executive

Date : 2026-05-28
Statut : design valide par l'utilisateur

## Objectif

Refondre la landing publique MemorIA pour sortir d'une grammaire SaaS standard et installer une perception plus premium, executive et operationnelle.

La page doit convaincre rapidement un dirigeant ou un responsable d'exploitation que MemorIA n'est pas un outil de productivite generique, mais une memoire operationnelle exploitable : elle conserve le contexte des lieux, facilite les passations, documente les preuves et aide a mieux repondre aux appels d'offres.

## Direction retenue

Direction : **Archive claire executive**.

Registre souhaite :
- fond pierre clair legerement froid ;
- surfaces blanc froid ;
- texte graphite ;
- accents acier / bleu-gris ;
- bleu MemorIA conserve seulement pour les actions et quelques details de marque ;
- rouge et ambre reserves aux anomalies et vigilances reelles.

La page doit rester lisible, sobre et credible. Le premium doit venir de la composition, de la hierarchie, des espacements, du rythme narratif et de la precision des exemples, pas d'effets decoratifs.

## Premier ecran

Le premier ecran devient une scene de passation executive.

Titre propose :

> La memoire des lieux ne doit plus partir avec les personnes.

Sous-texte :

> MemorIA conserve les acces, a-savoir, anomalies, preuves et passations de chaque site, puis les fait remonter au moment ou une equipe, un contrat ou un appel d'offres en a besoin.

Visuel principal :
- extrait de brief de passation ;
- site exemple : `Medipole - Blocs operatoires` ;
- equipe sortante : `Noumea Centre` ;
- releve prevue dans `18 jours` ;
- informations visibles : acces, a savoir, anomalie recente, preuves disponibles ;
- statut discret : `Memoire prete a transmettre`.

Objectif du premier ecran :
- rendre la promesse concrete immediatement ;
- remplacer l'impression "outil SaaS" par une impression "dossier operationnel utilisable par la direction" ;
- donner le signal premium sans perdre la comprehension terrain.

## Structure narrative

La page suit quatre moments.

### 1. Quand le savoir part

Section courte et froide qui montre la fragilite :
- une personne experimentee quitte l'entreprise ;
- une equipe reprend un site sans contexte ;
- un client conteste une prestation sans preuve claire.

Cette section remplace une partie de la logique "Avant / Apres" trop classique.

### 2. Ce que MemorIA garde

Section en forme de registre de memoire :
- acces ;
- consignes et a-savoir ;
- anomalies ;
- preuves ;
- historique de passation ;
- references utiles pour AO.

Le rendu doit eviter la grille de cartes repetitive. Il peut prendre la forme de lignes structurees, colonnes fines ou registre sobre.

### 3. Ce que MemorIA fait remonter

Section coeur de page, avec les meilleurs exemples concrets de la landing actuelle :
- Dumbea Mall : plusieurs signalements jamais relies ;
- Medipole : passation a preparer ;
- appel d'offres : references terrain deja disponibles.

Ce bloc doit arriver plus haut que dans la page actuelle, car il incarne le mieux la valeur produit.

### 4. Ce que la direction gagne

Conclusion business :
- continuite d'exploitation ;
- dossiers de preuves ;
- appels d'offres mieux argumentes ;
- passations moins dependantes des personnes.

Le CTA final doit etre sobre. Il ne doit pas reprendre le gros bloc bleu SaaS actuel.

## Composants visuels

Composants prevus :
- brief executive dans le hero ;
- registre de memoire ;
- lignes de preuve pour les exemples concrets ;
- CTA principal `Demander une demo` ;
- CTA secondaire `Acceder a l'app` ;
- footer minimal.

Les sections doivent varier en forme pour eviter l'empilement de cartes blanches identiques.

## Contraintes d'implementation

Fichier principal :
- `app/LandingPage.tsx`

A conserver :
- route `/` existante ;
- redirection vers `/dashboard` pour un utilisateur connecte ;
- CTA mail de demo ;
- lien `/login` ;
- logo existant ;
- contenu metier utile deja present.

A ne pas modifier :
- authentification ;
- layouts globaux ;
- themes applicatifs ;
- variables globales, sauf petite classe locale indispensable.

## Verification

Commandes ciblees :
- `npm run lint`
- `npm run typecheck`

Si possible :
- verification visuelle locale ;
- sinon build ou inspection statique si le serveur Next reste instable.

## Risques et garde-fous

Risque : produire du "bruit premium".
Garde-fou : chaque section doit aider a comprendre la memoire operationnelle, la passation, la preuve ou la valeur direction.

Risque : perdre la credibilite terrain.
Garde-fou : conserver des exemples concrets de sites, equipes, anomalies, preuves et passations.

Risque : devenir trop institutionnel.
Garde-fou : garder le hero et les exemples ancres dans des situations operationnelles reelles.
