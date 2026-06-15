# Comprendre l'architecture de MemorIA — guide pour débutant

> **Pour Vincent et toute personne qui veut comprendre comment MemorIA est construit, sans être ingénieur.**
>
> Chaque notion suit le même plan : *« c'est quoi »* (analogie simple) → *« pourquoi ça existe »* → *« comment c'est appliqué chez nous »* (exemple concret).
>
> Pas de jargon gratuit. Si un mot technique apparaît, il est expliqué.

---

## Sommaire

- [Partie 1 — Où vivent les données (les fondations)](#partie-1--où-vivent-les-données)
- [Partie 2 — Comment le sens est calculé (la couche IA)](#partie-2--comment-le-sens-est-calculé)
- [Partie 3 — Comment l'application tourne (Next.js)](#partie-3--comment-lapplication-tourne)
- [Partie 4 — Les garde-fous (sécurité & doctrine)](#partie-4--les-garde-fous)
- [Partie 5 — Les patterns d'exécution](#partie-5--les-patterns-dexécution)
- [Partie 6 — Vocabulaire express](#partie-6--vocabulaire-express)
- [**Partie 7 — Les systèmes métier construits (référence détaillée, admin)**](#partie-7--les-systèmes-métier-construits-référence-détaillée)

---

# Partie 1 — Où vivent les données

## 1.1 — La base de données (Postgres)

**C'est quoi** : une base de données, c'est un **classeur géant** organisé en tableaux. Chaque tableau (on dit « table ») a des colonnes (les champs) et des lignes (les enregistrements).

> **Analogie** : un tableur Excel, mais en beaucoup plus costaud, capable de gérer des millions de lignes et de relier les tableaux entre eux.

**Postgres** (ou PostgreSQL) est le moteur de base de données qu'on utilise. C'est l'un des plus solides et respectés au monde, gratuit et open-source.

**Chez nous** : on a des tables comme `sites`, `contracts`, `interventions`, `teams`, `documents`, `handover_briefs`… Chaque intervention de Joseph est une ligne dans la table `interventions`.

---

## 1.2 — Supabase

**C'est quoi** : Supabase, c'est **Postgres + tous les services autour, prêts à l'emploi**. Au lieu d'installer et de gérer un serveur de base de données toi-même, Supabase te le fournit clé en main, dans le cloud, avec en bonus :
- L'**authentification** (login, mots de passe)
- Le **stockage de fichiers** (les PDF, les photos)
- Les **API automatiques** (pour parler à la base depuis l'application)
- L'extension **pgvector** (voir Partie 2)

> **Analogie** : Postgres tout seul, c'est un moteur de voiture. Supabase, c'est la voiture complète, avec carrosserie, sièges, tableau de bord — tu n'as plus qu'à conduire.

**Chez nous** : toute la donnée MemorIA vit dans Supabase. Quand Joseph prend une photo sur le terrain, elle part dans le stockage Supabase, et une ligne est créée dans la table `intervention_photos`.

---

## 1.3 — Les relations entre tables (clés étrangères)

**C'est quoi** : les tables sont **reliées** entre elles. Une intervention appartient à une mission, qui appartient à un site, qui appartient à un contrat. Ces liens s'appellent des **clés étrangères** (foreign keys).

> **Analogie** : sur ta facture, il y a un « numéro de client ». Ce numéro pointe vers la fiche du client dans un autre fichier. C'est une clé étrangère : un lien entre deux tableaux.

**Chez nous** : `interventions.assigned_team_id` pointe vers `teams.id`. Ça veut dire : « cette intervention est affectée à cette équipe ».

**Détail important — que se passe-t-il si on supprime ?** On configure le comportement :
- `ON DELETE SET NULL` : si on supprime l'équipe, l'intervention n'est pas supprimée, juste « désaffectée » (le lien devient vide). C'est ce qu'on utilise pour les équipes : **supprimer une équipe ne détruit jamais l'historique des interventions**.
- `ON DELETE CASCADE` : si on supprime l'élément parent, les enfants sont supprimés aussi. On l'utilise quand les enfants n'ont aucun sens sans le parent (ex. les photos d'une intervention supprimée).

---

## 1.4 — Le soft delete (« suppression douce »)

**C'est quoi** : au lieu d'effacer réellement une ligne, on lui met une **date de suppression** (`deleted_at`). La ligne reste en base, mais l'application fait comme si elle n'existait plus.

> **Analogie** : la corbeille de ton ordinateur. Le fichier n'est pas vraiment détruit, il est juste marqué « à la corbeille ». Tu peux le récupérer.

**Pourquoi** : pour **ne jamais perdre l'historique**. C'est fondamental pour MemorIA — l'artefact brut n'est jamais détruit (doctrine de la mémoire). Un audit, un litige, une réclamation peut nécessiter de retrouver ce qui existait il y a 6 mois.

**Chez nous** : presque toutes les tables ont une colonne `deleted_at`. Archiver une équipe = mettre `deleted_at = maintenant`, pas l'effacer.

---

## 1.5 — Les contraintes (CHECK, NOT NULL, unique)

**C'est quoi** : des **règles que la base refuse de violer**. Si tu essaies d'insérer une donnée qui ne respecte pas la règle, la base rejette l'opération.

> **Analogie** : un formulaire papier avec « champ obligatoire » et « format attendu : JJ/MM/AAAA ». Si tu remplis mal, on te rend le formulaire.

**Types** :
- `NOT NULL` : ce champ doit être rempli
- `UNIQUE` : pas deux fois la même valeur (ex. pas deux équipes avec le même nom)
- `CHECK` : une règle personnalisée (ex. « le statut doit être l'un de : open / resolved / ignored »)

**Chez nous** : la table `teams` a un `CHECK` qui force la couleur à être soit un nom whitelisté, soit un code hex valide `#rrggbb`. Impossible d'enregistrer une couleur invalide, même par bug. **La base est la dernière ligne de défense.**

---

## 1.6 — Les index (et pourquoi c'est rapide)

**C'est quoi** : un index, c'est un **raccourci de recherche**. Sans index, pour trouver une ligne, la base lit tout le tableau. Avec index, elle va directement au bon endroit.

> **Analogie** : l'index alphabétique à la fin d'un livre. Sans lui, tu lirais les 400 pages pour trouver « désinfection ». Avec lui, tu vas direct à la page 287.

**Chez nous** : on a un index sur `intervention_anomalies(intervention_id)` pour retrouver instantanément les anomalies d'une intervention. Et un **index spécial** (GIN) sur `teams.specialties` pour chercher vite « quelles équipes font du bio-nettoyage ».

**Index partiel** : un index qui ne couvre qu'une partie des lignes (ex. seulement les anomalies « ouvertes »). Plus léger, plus rapide pour les cas fréquents.

---

## 1.7 — Les migrations (versionning de la base)

**C'est quoi** : à mesure que le produit évolue, la **structure** de la base change (nouvelles tables, nouvelles colonnes). Chaque changement est écrit dans un **fichier numéroté** qu'on garde pour toujours. Ce sont les **migrations**.

> **Analogie** : le carnet d'entretien d'une voiture. Chaque intervention est datée et notée. On peut reconstituer toute l'histoire des modifications.

**Chez nous** : `supabase/migrations/077_teams_icon_and_color.sql`, `078_teams_specialties.sql`, etc. Numérotées dans l'ordre. Pour reconstruire la base de zéro, on rejoue les migrations dans l'ordre.

**Pourquoi c'est sérieux** : ça permet à plusieurs personnes (et plusieurs environnements : ton ordi, le serveur de prod) d'avoir **exactement la même structure**. Pas de « ça marche chez moi mais pas en prod ».

---

## 1.8 — L'idempotence

**C'est quoi** : une opération est **idempotente** si la lancer une fois ou dix fois donne le même résultat. Pas d'effet de bord si on rejoue.

> **Analogie** : l'interrupteur « éteindre la lumière ». Appuyer une fois ou trois fois quand c'est déjà éteint → la lumière reste éteinte. Pas de problème. À l'inverse, « ajoute 10€ » n'est PAS idempotent : le rejouer change le résultat.

**Pourquoi** : si une migration plante à moitié et qu'on la rejoue, elle ne doit pas exploser sur « cette colonne existe déjà ».

**Chez nous** : nos migrations utilisent `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `CREATE OR REPLACE`. Résultat : on peut rejouer une migration sans risque. *(C'est une erreur qu'on a faite au début — les migrations 077/078 n'étaient pas idempotentes et ont planté au 2e essai. Corrigé.)*

---

# Partie 2 — Comment le sens est calculé

C'est la partie « IA » du système. Le cœur.

## 2.1 — Le chunking (découpage)

**C'est quoi** : couper un document en **petits morceaux** (les « chunks ») de quelques paragraphes chacun.

> **Analogie** : déchirer un livre en fiches bristol, une idée par fiche. Plus facile de retrouver la bonne fiche que de relire le livre.

**Pourquoi** : un document de 40 pages parle de 15 sujets. Si on cherche « protocole désinfection », on veut **le bon paragraphe**, pas tout le PDF.

**Chez nous** : quand tu charges un CCTP, il est découpé en chunks. Chaque chunk garde son texte intégral en base (table `knowledge_chunks`).

---

## 2.2 — L'OCR (lire les scans)

**C'est quoi** : OCR = « reconnaissance optique de caractères ». C'est la technologie qui **transforme une image de texte en texte éditable**.

> **Analogie** : tu prends en photo une page de journal. L'OCR « lit » la photo et te ressort le texte que tu peux copier-coller.

**Pourquoi** : beaucoup de PDF sont des **scans** (des photos de papier). Sans OCR, l'ordinateur ne voit qu'une image, pas du texte.

**Chez nous** : si un PDF chargé est un scan, on déclenche l'OCR. *(C'est exactement ce qu'on a fait sur ton PDF ChatGPT de 382 pages : c'étaient des captures d'écran — des images — donc on a passé chaque page dans Gemini Vision pour en extraire le texte.)*

---

## 2.3 — Les embeddings (l'empreinte de sens)

**C'est quoi** : prendre un texte et le transformer en **une liste de 768 nombres** qui représente son **sens**. C'est l'embedding.

> **Analogie** : les coordonnées GPS. Avec 2 nombres (latitude, longitude) tu places un point sur Terre, et deux villes proches ont des coordonnées proches. Un embedding, c'est pareil mais avec **768 nombres** pour placer un texte dans « l'espace du sens ». Deux textes qui veulent dire la même chose ont des positions proches.

**La magie** : *« PC sécurité bloqué »*, *« accès SAS fermé »* et *« porte impossible à ouvrir »* n'ont **aucun mot en commun**, mais leurs empreintes sont **proches** — parce qu'elles parlent toutes du même problème : un accès physique bloqué. Une recherche par mots-clés les raterait. La recherche par embedding les rapproche.

**Chez nous** : on utilise le modèle `gemini-embedding-001` (de Google) qui produit 768 nombres par texte. Chaque chunk de document et chaque trace terrain reçoit son embedding.

**Calculé une fois** : l'embedding est calculé **à l'enregistrement**, jamais recalculé. Stocké. Réutilisé gratuitement.

---

## 2.4 — pgvector (le classeur magique)

**C'est quoi** : une **extension de Postgres** qui sait stocker les embeddings (les listes de 768 nombres) et surtout **trouver très vite les plus proches**.

> **Analogie** : un classeur magique. Tu lui montres une fiche, il te sort instantanément les 5 fiches « qui se ressemblent le plus » dans toute l'archive — par le sens, pas par les mots.

**Pourquoi** : comparer une question à 50 000 chunks « à la main » serait lent. pgvector fait ça en millisecondes.

**Chez nous** : c'est pgvector qui, quand un AO arrive, retrouve les AO passés similaires et les documents pertinents.

---

## 2.5 — Cosine, distance, similarité (mesurer la proximité)

**C'est quoi** : pour savoir si deux empreintes sont « proches », on mesure l'**angle entre elles** (vues comme deux flèches dans l'espace du sens). C'est le **cosinus** (« cosine »).

- Cosine = 1 → même direction → sens identique
- Cosine = 0 → perpendiculaire → aucun rapport

**Distance vs similarité — la nuance qui piège tout le monde** :
- pgvector mesure une **distance** : 0 = identique, plus c'est grand plus c'est différent
- Nous on raisonne en **similarité** : 1 = identique, 0 = sans rapport
- Conversion : `similarité = 1 − distance/2`

> Donc une **similarité cible de 0.60** correspond à une **distance maximale de 0.80**. Si tu vois « 0.80 » dans le code, c'est la distance ; la similarité visée est ~0.60. C'est la même chose vue à l'envers.

**Chez nous** : le seuil de similarité est autour de **0.55 à 0.60** selon le contexte. Au-dessus → on considère que ça « résonne ». En-dessous → on ignore. **Ce seuil n'est pas une vérité gravée** : c'est un curseur ajustable qu'on règle selon ce qu'on observe (« un cosine n'est pas un fait »).

---

## 2.6 — Le pipeline IA (la chaîne de traitement)

**C'est quoi** : un « pipeline », c'est une **chaîne d'étapes** où la sortie de l'une est l'entrée de la suivante.

> **Analogie** : une chaîne de montage. Pièce brute → découpe → assemblage → peinture → contrôle qualité → produit fini.

**Chez nous, le pipeline d'un document** :
```
PDF brut → extraction texte (OCR si scan) → découpage en chunks
       → calcul des embeddings → stockage en base → prêt à résonner
```

Et le pipeline d'un AO ajoute, **sur ton clic** :
```
... → 6 agents IA (analyse) → mémoire technique → persistance
```

---

## 2.7 — IA générative vs recherche vectorielle (la distinction cruciale)

C'est **la** chose à comprendre sur le coût et la fiabilité.

| | IA générative | Recherche vectorielle |
|---|---|---|
| **Ce que ça fait** | Écrit du texte nouveau | Trouve ce qui se ressemble |
| **Exemple** | Les 6 agents AO rédigent une mémoire technique | Retrouver les AO similaires |
| **Coût** | Cher (~5-10 F / AO) | Quasi gratuit (centimes) |
| **Fiabilité** | Peut « halluciner » (inventer) | Ne peut pas inventer (juste comparer des nombres) |
| **Chez nous** | Confiné à l'Atelier AO, sur action | Partout, en arrière-plan |

**Le point honnête** : ce qui paraît « magique » dans MemorIA (les résonances qui « comprennent ») n'est **pas** de l'IA générative. C'est de la **comparaison d'empreintes** — des maths. Moins « intelligent » qu'il n'y paraît, mais **fiable et pas cher**, et impossible à halluciner.

---

# Partie 3 — Comment l'application tourne

## 3.1 — Next.js (le cadre de l'application)

**C'est quoi** : Next.js est le **framework** (la boîte à outils) qui fait tourner l'application web MemorIA. Il gère les pages, la navigation, le lien avec la base.

> **Analogie** : si construire une app était cuisiner, Next.js serait la cuisine équipée — four, plaques, ustensiles déjà installés. Tu te concentres sur la recette, pas sur la plomberie.

---

## 3.2 — Server Components & Server Actions

**C'est quoi** : dans MemorIA, beaucoup de code s'exécute **sur le serveur** (pas dans le navigateur de l'utilisateur).

- **Server Component** : une page calculée côté serveur, qui arrive déjà prête au navigateur. Rapide, sécurisé (le code sensible ne part jamais chez l'utilisateur).
- **Server Action** : une fonction qui s'exécute sur le serveur quand tu cliques un bouton (créer une équipe, résoudre une anomalie).

> **Analogie** : au restaurant, tu ne vas pas en cuisine. Tu passes commande (Server Action), le plat est préparé en cuisine (serveur), et on te l'apporte fini (Server Component). Tu ne vois jamais les couteaux.

**Pourquoi c'est important pour la sécurité** : les clés secrètes, les requêtes sensibles **restent côté serveur**. Le navigateur de Guillaume ne voit jamais le token Supabase.

---

## 3.3 — Le cache et `force-dynamic`

**C'est quoi** : par défaut, Next.js **garde en mémoire** (cache) les pages pour aller plus vite. Mais certaines pages doivent **toujours être fraîches**.

> **Analogie** : une photo (cache) vs une webcam en direct (dynamique). Pour un planning qui change tout le temps, tu veux le direct.

**Chez nous** : les pages sensibles (dashboard, briefs, `/h/[token]`) sont en `force-dynamic` — recalculées à chaque visite. Crucial pour `/h/[token]` : si tu révoques un lien de partage, il doit être **immédiatement** mort, pas servi depuis un cache.

**`revalidatePath`** : quand on modifie une donnée (créer une équipe), on dit à Next.js « la page /equipes n'est plus à jour, recalcule-la ». Ça rafraîchit l'affichage.

---

## 3.4 — Zod (le videur à l'entrée)

**C'est quoi** : Zod est un outil qui **vérifie que les données reçues ont la bonne forme** avant de les traiter.

> **Analogie** : le videur à l'entrée d'une boîte. Il vérifie que tu as le bon âge, la bonne tenue. Si tu ne corresponds pas aux règles, tu n'entres pas.

**Pourquoi** : ne **jamais faire confiance** aux données qui arrivent (un bug, un pirate, un formulaire mal rempli). On valide tout à l'entrée.

**Chez nous** : avant de créer une équipe, Zod vérifie que le nom fait 1-50 caractères, que la couleur est un nom valide ou un hex, que l'icône est dans la liste autorisée. Si ça ne passe pas → erreur claire, pas de donnée corrompue en base.

---

## 3.5 — TypeScript (le filet de sécurité du code)

**C'est quoi** : TypeScript, c'est du JavaScript (le langage du web) avec des **types** : on déclare qu'une variable est un texte, un nombre, une date… Et le système **refuse de compiler** si on se trompe.

> **Analogie** : les prises électriques avec détrompeur. Tu ne peux pas brancher la prise dans le mauvais sens — la forme l'empêche. TypeScript empêche de brancher un texte là où on attend un nombre.

**Chez nous** : avant chaque mise en ligne, on lance `tsc` (le vérificateur). S'il trouve une erreur de type, on corrige avant que ça parte en prod. *(C'est mon garde-fou n°1 — je le lance avant chaque commit.)*

---

# Partie 4 — Les garde-fous

C'est ici que MemorIA devient sérieux **éthiquement**, pas juste techniquement.

## 4.1 — RLS (Row Level Security)

**C'est quoi** : « sécurité au niveau de la ligne ». La base elle-même décide **qui a le droit de voir quelle ligne**, selon le rôle de l'utilisateur.

> **Analogie** : un coffre-fort où chaque tiroir s'ouvre selon ta carte d'accès. Le coffre lui-même vérifie — pas le gardien qui pourrait se tromper.

**Pourquoi c'est fort** : même si l'application avait un bug, la **base** refuserait de montrer une donnée à quelqu'un qui n'y a pas droit. La sécurité est au plus bas niveau possible.

**Chez nous** : un chef d'équipe ne peut voir que ses propres données. Un manager voit plus. La fonction `current_user_role()` côté base détermine le rôle, et chaque table a ses règles RLS.

---

## 4.2 — Service role vs clé publique

**C'est quoi** : Supabase a deux types de clés :
- La clé **publique** (anon) : pouvoirs limités, peut vivre dans le navigateur
- La clé **service role** : tous les pouvoirs, **doit rester secrète côté serveur**

> **Analogie** : le passe-partout du gérant (service role) vs la clé de ta chambre d'hôtel (anon). Le passe ne sort jamais de la réception.

**Chez nous** : la route publique `/h/[token]` utilise le service role **côté serveur** pour lire un brief sans login — mais la clé ne quitte jamais le serveur. Le visiteur ne reçoit que le contenu, jamais la clé.

---

## 4.3 — Les tripwires (fils-pièges doctrinaux)

**C'est quoi** : un test automatique qui **fait échouer la mise en ligne** si le code contient quelque chose d'interdit.

> **Analogie** : un détecteur de métaux à l'aéroport. Si quelqu'un essaie de faire passer un objet interdit, l'alarme bloque tout. Sauf qu'ici c'est automatique et impersonnel.

**Pourquoi c'est rare et mature** : on **encode l'éthique dans le code lui-même**. Pas juste « on s'est mis d'accord pour ne pas faire ça » — le système **refuse techniquement** de le faire.

**Chez nous** : le fichier `forbidden-symbols.test.ts` interdit des noms comme `departureRisk`, `criticalAgent`, `replacementScore`, `agentRanking`. Si un développeur (même dans 2 ans, même sous pression client) essaie de coder une fonction « score de l'agent », **la CI échoue** et le code ne part pas. La doctrine « pas de surveillance RH » est gravée dans le béton.

---

## 4.4 — Les allowlists (listes blanches confinées)

**C'est quoi** : au lieu d'interdire au cas par cas, on **autorise seulement à un endroit précis** une chose normalement interdite.

> **Analogie** : un produit dangereux rangé dans une seule armoire fermée à clé, avec une étiquette « usage confiné ». Partout ailleurs, son usage déclenche l'alarme.

**Chez nous** : agréger des données par personne (`user_id`) est normalement interdit (doctrine anti-surveillance). MAIS la fiche Intervenant et la page Continuité en ont besoin. Donc on **confine** cette capacité à deux fichiers précis (`lib/db/intervenants.ts`, `lib/db/continuity.ts`). Tout autre fichier qui tente d'agréger par personne → tripwire → CI rouge. La transgression est **possible mais surveillée et localisée**.

---

## 4.5 — Les kill switches (interrupteurs d'arrêt)

**C'est quoi** : un **interrupteur** qui désactive une fonctionnalité en une seconde, sans toucher au code.

> **Analogie** : l'arrêt d'urgence rouge sur une machine. Un appui, tout s'arrête.

**Pourquoi** : si une feature sensible (page Intervenants, page Continuité) provoque un malaise pendant le pilote, on la coupe **immédiatement** sans attendre une nouvelle mise en ligne.

**Chez nous** : des variables d'environnement comme `INTERVENANTS_PAGE_ENABLED` et `CONTINUITY_PAGE_ENABLED`. Si on les met à `false`, la page renvoie « introuvable » instantanément. La feature existe mais devient invisible.

---

## 4.6 — Les variables d'environnement (.env)

**C'est quoi** : des **réglages secrets** rangés en dehors du code, dans un fichier `.env.local` qui n'est jamais publié.

> **Analogie** : le code PIN de ta carte. Il fait fonctionner la carte, mais tu ne l'écris pas sur la carte. Il vit ailleurs, secret.

**Chez nous** : les clés Supabase, la clé Gemini, le token de migration, les kill switches. Le fichier `.env.local` est dans le `.gitignore` (jamais publié sur GitHub). *(C'est aussi le fichier que j'ai cassé deux fois en y ajoutant mal une variable — d'où l'entrée dans le journal d'erreurs.)*

---

## 4.7 — L'audit log (le registre des consultations)

**C'est quoi** : un **journal** qui note qui a fait quoi, quand. Chaque action sensible laisse une trace.

> **Analogie** : le registre d'entrée d'un immeuble sécurisé. On note chaque visiteur, chaque heure.

**Pourquoi** : pour les transgressions assumées (consulter une fiche personne), on veut pouvoir **savoir qui a consulté quoi**. Surveillance de la surveillance.

**Chez nous** : la table `activity_logs`. Chaque consultation de la page Continuité, chaque génération de brief, chaque résolution d'anomalie y est tracée. Tu peux voir qui a regardé la fiche de qui, combien de fois.

---

## 4.8 — Les tokens de partage signés

**C'est quoi** : pour partager un brief sans login, on génère un **code unique imprévisible** (le token). Qui a le code accède au contenu ; sans le code, rien.

> **Analogie** : un coffre à code à usage temporaire. Tu donnes le code à qui tu veux, il expire après X jours, et tu peux le révoquer.

**Comment c'est sûr** : le token est généré avec de la **cryptographie** (`crypto.randomBytes`) — 32 caractères impossibles à deviner. Pas de « token1, token2 » prévisibles.

**Chez nous** : `/h/[token]` pour les briefs de passation. Token expirable (1-60 jours), révocable, chaque accès est compté. Joseph ouvre sans login, mais personne ne peut deviner l'URL.

---

# Partie 5 — Les patterns d'exécution

## 5.1 — Fire-and-forget (« lance et oublie »)

**C'est quoi** : lancer une tâche **en arrière-plan** sans attendre qu'elle finisse, pour ne pas bloquer l'utilisateur.

> **Analogie** : tu mets une lessive en route et tu vas faire autre chose. Tu ne restes pas planté devant la machine pendant 1h30.

**Pourquoi** : calculer les embeddings d'un gros document prend quelques secondes. On ne veut pas que Guillaume attende, écran figé. On lui rend la main tout de suite, et le calcul se fait derrière.

**Chez nous** : quand tu charges un document, l'upload répond immédiatement ; l'embedding se calcule en tâche de fond. Quand c'est prêt, le document devient « résonnable ».

---

## 5.2 — Async / batch (par lots)

**C'est quoi** :
- **Async** (asynchrone) : ne pas tout faire d'un coup en bloquant, mais en arrière-plan.
- **Batch** (par lots) : grouper plusieurs traitements ensemble pour aller plus vite et moins cher.

> **Analogie batch** : tu ne fais pas tourner le lave-vaisselle pour une seule assiette. Tu attends d'avoir un lot. Plus efficace.

**Chez nous** : les embeddings sont calculés **en batch** (plusieurs chunks d'un coup) et **en async** (arrière-plan). Et pour ton PDF ChatGPT, on a découpé en lots de 20 pages envoyés à Gemini un par un — du batch.

---

## 5.3 — Pré-calcul (préparer à l'avance)

**C'est quoi** : faire le travail coûteux **une fois, à l'avance**, pour que le moment d'utilisation soit instantané et gratuit.

> **Analogie** : les mises en place du matin en cuisine. Au coup de feu, tout est prêt — on n'épluche pas les légumes à la commande.

**Pourquoi c'est notre doctrine** : on **refuse les « LLM live partout »**. Si chaque page demandait à un gros modèle de réfléchir à chaque ouverture, ce serait lent, cher et faillible. À la place : on pré-calcule les embeddings, et la recherche au moment voulu est instantanée et gratuite.

**Chez nous** : « discipline coût IA » → async pré-calcul + recherche bornée, jamais LLM live en arrière-plan permanent.

---

## 5.4 — L'abstraction de provider (mock / gemini / anthropic / openai)

**C'est quoi** : le code ne parle pas directement à « Gemini ». Il parle à une **interface neutre** qui peut brancher Gemini, OpenAI, Anthropic, ou un faux (« mock ») pour les tests.

> **Analogie** : une prise électrique universelle. Tu branches l'appareil ; derrière, ça peut être de l'éolien, du solaire, du nucléaire — l'appareil s'en fiche.

**Pourquoi** : ne pas être **prisonnier d'un fournisseur**. Si Gemini augmente ses prix ou ferme, on bascule sur OpenAI en changeant une variable. Et pour développer sans payer, on utilise le mode `mock` (fausses réponses).

**Chez nous** : variable `AI_PROVIDER`. Les premiers écrans que tu as vus dans le PDF ChatGPT étaient en mode `mock` (« réponse de démo, pas basée sur le vrai PDF »).

---

## 5.5 — Les hooks

**C'est quoi** : un « hook » est un **point d'accroche** où on branche du code qui se déclenche automatiquement quand un événement arrive.

> **Analogie** : le détecteur de mouvement qui allume la lumière. Tu n'appuies pas l'interrupteur ; l'événement (mouvement) déclenche l'action (lumière).

**Deux sens chez nous** :
- **Hooks React** (`useState`, `useTransition`) : dans l'interface, pour gérer l'état d'un bouton (ex. « en cours d'envoi… »).
- **Hooks d'outils** (côté dev) : du code qui se déclenche à un moment du cycle (avant un commit, au démarrage d'une session).

---

## 5.6 — Le snapshot immuable

**C'est quoi** : figer une donnée à un instant T pour qu'elle **ne change plus jamais**, même si les données d'origine évoluent.

> **Analogie** : une photo. Le paysage change, mais la photo de l'an dernier reste l'an dernier. Tu peux prouver « voilà ce qui était là ce jour-là ».

**Pourquoi** : un brief de passation généré en mars doit refléter **mars**, même rouvert en juin. C'est une **preuve** : « voilà ce qu'on a transmis, ce jour-là ».

**Chez nous** : le `payload` (contenu) d'un brief est stocké en **JSONB** (un format qui range une structure complète dans une seule colonne) et n'est jamais modifié après création. Seules les notes manager restent éditables.

---

# Partie 6 — Vocabulaire express

Pour réviser d'un coup d'œil :

| Terme | En une phrase |
|---|---|
| **Postgres** | Le moteur de base de données (le classeur géant) |
| **Supabase** | Postgres + auth + stockage + API, clé en main dans le cloud |
| **Clé étrangère** | Un lien entre deux tables (intervention → équipe) |
| **Soft delete** | Marquer « supprimé » sans effacer (la corbeille) |
| **CHECK / contrainte** | Règle que la base refuse de violer |
| **Index** | Raccourci de recherche (l'index d'un livre) |
| **Migration** | Fichier numéroté décrivant un changement de structure |
| **Idempotent** | Rejouable sans effet de bord (l'interrupteur) |
| **Chunk** | Un morceau de document découpé |
| **OCR** | Lire le texte d'une image/scan |
| **Embedding** | L'empreinte de sens d'un texte (768 nombres) |
| **pgvector** | L'extension qui trouve vite les empreintes proches |
| **Cosine / similarité** | Mesure de proximité de sens entre deux empreintes |
| **Pipeline** | Chaîne d'étapes de traitement |
| **IA générative** | Écrit du texte nouveau (cher, faillible) |
| **Recherche vectorielle** | Trouve ce qui se ressemble (gratuit, fiable) |
| **Next.js** | Le framework de l'application web |
| **Server Action** | Fonction serveur déclenchée par un clic |
| **force-dynamic** | Page toujours recalculée (jamais en cache) |
| **Zod** | Le videur qui valide les données à l'entrée |
| **TypeScript** | JavaScript avec types (le détrompeur de prises) |
| **RLS** | Sécurité au niveau de la ligne (le coffre intelligent) |
| **Service role** | Clé tous-pouvoirs, secrète, côté serveur |
| **Tripwire** | Test qui bloque le code interdit (détecteur aéroport) |
| **Allowlist** | Autorisation confinée à un seul endroit |
| **Kill switch** | Interrupteur d'arrêt d'urgence (variable d'env) |
| **Variable d'env** | Réglage secret hors du code (.env.local) |
| **Audit log** | Journal de qui a fait quoi quand |
| **Token signé** | Code de partage imprévisible, expirable |
| **Fire-and-forget** | Lancer en arrière-plan sans attendre |
| **Batch** | Traiter par lots (le lave-vaisselle plein) |
| **Pré-calcul** | Préparer à l'avance (les mises en place) |
| **Provider abstraction** | Interface neutre pour changer de fournisseur IA |
| **Hook** | Point d'accroche déclenché par un événement |
| **Snapshot immuable** | Donnée figée à un instant T (la photo) |
| **JSONB** | Format Postgres qui range une structure complète dans une colonne |

---

## Le moteur de signaux mémoire — « 1 source, N surfaces »

Comment le tableau de bord, le planning et les passages de témoin affichent-ils les **mêmes** signaux sans les recalculer chacun de leur côté ? Grâce à un petit moteur en **4 couches** :

1. **Détecteurs** (`lib/memory/signals/*`) — des fonctions **pures et déterministes** qui produisent des faits : « ce site n'a pas parlé depuis 12 jours », « cette passation attend une reconnaissance ». Pas d'IA, pas de LLM — du SQL et des règles.
2. **Collecteur** — lance tous les détecteurs, à plat (aucun classement global).
3. **Contextualiseur** (`forSurface`) — décide **quand parler** selon la surface (dashboard ≠ planning) et résout les conflits (un signal de santé masque un signal fragile).
4. **Renderer** — le **seul** responsable du texte affiché.

> [!IMPORTANT] La grammaire stricte
> Un signal ne contient **jamais** de texte, ni de personne comme sujet, ni de score caché. Le sujet est **un lieu ou une équipe, jamais un individu**. Cette discipline est testée (tests dans le même commit).

Résultat : **une seule source de vérité**, déclinée sur plusieurs écrans, expliquée et réversible.

## Le pipeline d'ingestion documentaire

Importer un document n'est pas « le vectoriser ». C'est un **pipeline** qui décide d'abord *si* le document mérite la mémoire active :

```
PDF déposé
  → classifyDocument()      (pur : type → couche + reco d'indexation + pourquoi)
  → triage humain           (l'humain valide type / indexation)
  → createDocument()        (stockage privé + métadonnées + memory_tier)
  → analyzeDocument()       (UNIQUEMENT si indexation validée)
       → extraction → chunking sémantique → embeddings → knowledge_chunks
```

> [!TIP] Embedding sélectif
> On ne lance l'étape coûteuse (embeddings) **que** pour les documents « vivante » / « consultable ». Les archives froides sont stockées sans coût IA. C'est la `ai-cost-discipline` appliquée : async, borné, jamais « LLM partout ».

> [!WARNING] Garde-fou litige
> Un document de type **litige** est forcé en *non indexé* **côté serveur** — on ne fait pas confiance au client. Un litige n'alimente jamais une lecture ou une résonance automatique.

L'import par lot réutilise **exactement** ce pipeline (même action, mêmes garde-fous), avec une **file bornée** (3 fichiers à la fois, jamais 50 en parallèle) et un **import partiel** (un PDF corrompu n'arrête pas les autres). Aucune nouvelle infra : on **étend** l'existant, on ne le double pas.

# Partie 7 — Les systèmes métier construits (référence détaillée)

> [!NOTE] Page admin
> Cette partie est **réservée aux admins** : elle décrit le détail technique réel (tables, migrations, fichiers, garde-fous) des grands systèmes ajoutés. C'est la mémoire d'ingénierie de ce qui a été construit.

## 7.1 — Compte-rendu & Réunions (le moteur d'alimentation)

**Idée** : on *raconte* une réunion (voix + texte + photos + pièces) → l'IA **propose** des décisions typées → l'humain **valide** → ça devient de vraies lignes. L'artefact brut n'est jamais perdu, même si l'IA échoue.

**Tables** (migrations 099 → 101) :
- `site_reports` — le compte-rendu : `type` (`contract`|`site`|`free`), `site_id` (nullable), `contract_id`, `status` (`draft`→`ready`→`analyzing`→`proposed`→`curated`/`failed`), `transcript_raw`/`_corrected`, `text_input`, `participants` (jsonb), `risks` (jsonb), `analysis_error`.
- `site_report_attachments` — audio/photo/fichier (bucket privé `site-reports`, idempotence par `client_uuid`).
- `site_report_proposals` — une décision proposée : `type` (action/intervention/mission/anomaly/vigilance/note/client_memory/proof_request), `payload` (jsonb), `short_label`, `corps_etat`, `assigned_to`, `site_id` (routage), `ai_confidence`, `status`, `created_entity_type/id`.
- `report_sites` — M:N réunion ↔ sites (une réunion contrat distribue ses décisions sur N sites ; pilote la visibilité au journal).

**IA** : `services/ai/site-report-analysis.ts` + prompt `site-report-analyzer.v1.ts`. Reçoit transcript + notes + **noms de pièces** (pas de vision) + sites candidats + actions ouvertes antérieures. Renvoie : présents, risques, comparaison aux actions précédentes, et décisions avec `site_index` (routage multi-sites confirmé par l'humain). `withAITracking` + fixture mock si pas de clé.

**Cycle** (`report-actions.ts`, gate `requireFieldAgent` = admin/manager/chef) : draft (texte d'abord) → upload pièces → transcription (`lib/ai/transcribe.ts`, partagé avec les notes vocales) → analyse → curation → **matérialisation** (route par `type` : `createSiteAction`, `createSiteNote`, `createAnomaly`, `createMission`, `createIntervention`). Échec → `status='failed'`, artefacts conservés.

**Surface** : menu **Réunions** (`/meetings`) — `listMeetings()` (résilient), vues *Actions ouvertes* / *Blocages* groupées par réunion, `NewMeetingButton` (réutilise `SiteReportPanel`). UI de capture/curation : `SiteReportPanel` / `SiteReportCuration` / `SiteReportLauncher`.

## 7.2 — Les Actions ouvertes (`site_actions`)

L'objet « il reste à faire » qui manquait — distinct de mission/intervention/anomalie.

- **Cycle** : `open` → `planned` (converti en intervention) → `done` | `cancelled`. Champs : `site_id`, `report_id` (origine), `title`, `corps_etat`, `assigned_to`, `due_date`, `converted_to_type/id`, et (migration 107) **`completed_comment`** + **`completed_photo_path`**.
- **Santé** = pure fonction d'ancienneté (`lib/actions/health.ts`, sans dépendance serveur → importable côté client) : 🔴 ≥ 14 j · 🟠 7–13 j · 🟢 < 7 j.
- **Surfaces** : `/actions` (cockpit global), fiche site, `/m/site` (*À suivre*), `/m/actions`, Briefing. Composant partagé `components/actions/OpenActionsList.tsx`. Compteur de nav calculé dans le layout via `getOpenActionsHealth()`.
- **Clôture avec trace** : `closeActionAction` (commentaire requis + photo optionnelle → bucket `intervention-photos`) → événement `type:'action'` au journal du site.
- **Planification** : `planActionAction` (mission existante/nouvelle + date + créneau → `createIntervention` + `markSiteActionPlanned`).

> [!IMPORTANT] Doctrine actions
> Action ≠ intervention (n'entre au planning que si planifiée). Action **ouverte** = pilotage (jamais embeddée). Action **terminée** = mémoire (journal), mais **hors résonance**. Jamais d'exécutant interne nommé.

## 7.3 — Contributions externes (qui a fait quoi)

Partager une intervention = confier une **contribution** (sous-ensemble de la checklist) à une **entreprise**, sans compte.

- `intervention_tokens` (mig. 097/098) : lien public `/i/[token]`, `permissions`, `recipient_label` (= l'entreprise), `validated_at`/`validated_by_name`/`validation_comment`, **`signature_data_url`/`signed_at`** (mig. 105/103).
- `intervention_token_items` (mig. 106) : **le périmètre** — quelles tâches ce token peut toucher.
- `intervention_checklist_items.executed_by_token_id` + `executed_at` (mig. 106) : l'exécutant externe par tâche.
- `intervention_photos.external_token_id` (mig. 104/105) : photos déposées par l'externe, par tâche (`checklist_item_id`).

> [!WARNING] Garde-fou serveur non négociable
> `actions-public.ts` filtre **côté serveur** toute action au périmètre du token (`resolveAllowedItemIds`) : cocher/photographier hors périmètre est **refusé**. Le scope affiché n'est jamais décoratif. Une seule signature par contribution. L'externe **ne clôture jamais** : il prouve, le chef contrôle et clôt.

- **Affichage** : badge « Réalisé par {entreprise} » par tâche (desktop `ExecutionPanel`, mobile `ChecklistMobile`). Bilan par contribution dans « Activités externes ».
- **Preuve** : `getProofDetail` (`lib/db/proofs.ts`) expose `external_contributions[]` + `executed_by_company` par tâche ; le **PDF** (`lib/pdf/proof-dossier.tsx`) rend la section *Contributions externes* avec la **signature manuscrite**. Le nom de l'entreprise est une preuve contractuelle (≠ identité salarié).

## 7.4 — Le journal du site (timeline)

`lib/db/site-memory.ts` — `getSiteMemoryTimeline()` agrège, **sans saisie**, une vue temporelle du lieu. `SiteMemoryEventType` : `intervention` · `photo` · `anomaly` · `note` · `a_savoir` · `access` · `report` · **`action`** (clôturée). Dédup transverse + tri antichronologique. **Embeddé pour les résonances** : seulement `photo_caption` / `anomaly` / `site_note` / `intervention_note` (`lib/ai/embed-trace.ts`). Les actions et contributions n'y entrent jamais.

## 7.5 — Ouverture contextuelle (page d'arrivée + GPS)

- **Page d'arrivée** `/m/site/[id]` : bandeau « Aujourd'hui ici » (interventions du jour + actions ouvertes + anomalies), « Attention » (à-savoir + anomalies), « À suivre », « Dernières preuves ». Atteignable par **QR** (mig. 092, `site_qr_tokens`) ou liste de sites — **sans GPS**.
- **GPS** (Phases 1-2, à venir) : lecture **foreground one-shot**, opt-in, **jamais stockée**, pas d'historique, pas d'arrière-plan. Réconcilie la doctrine anti-GPS : ce n'est pas du pointage (rien n'est écrit). Garde-fous à coder en dur avec la feature.

## 7.6 — Carte des migrations (092 → 107)

| # | Objet |
|---|---|
| 092 | `site_qr_tokens` — QR d'identification sur site |
| 097 / 098 | `intervention_tokens` (+ `recipient_label`) — partage externe |
| 099 | `site_reports`, `_attachments`, `_proposals`, **`site_actions`** |
| 100 | reconstruction réunion — `participants` / `risks` (jsonb) |
| 101 | réunion contrat multi-sites — `type`/`contract_id`, `report_sites`, `proposals.site_id` |
| 102 | `share_token_comments` — retours externes (dossier preuve) |
| 103 | `intervention_signature` |
| 104 | `share_comment_photos` |
| 105 | `external_execution_proof` — `signature_data_url`/`signed_at`, `photos.external_token_id` |
| 106 | `external_contribution_scope` — `intervention_token_items`, `executed_by_token_id` |
| 107 | `site_action_closure` — `completed_comment`/`completed_photo_path` |

---

## Le mot de la fin — pourquoi tout ça compte

Chaque notion ci-dessus n'est pas là « parce que c'est moderne ». Chacune sert **une des deux missions** de MemorIA :

1. **Faire émerger la bonne mémoire au bon moment** → embeddings, pgvector, cosine, chunking, pipeline IA
2. **Ne jamais trahir la doctrine** → RLS, tripwires, allowlists, kill switches, audit log, soft delete, snapshot immuable

Le niveau d'ingénierie est sérieux **parce que la promesse est sérieuse** : un système qui touche à la mémoire des gens et aux opérations d'une entreprise ne peut pas se permettre d'être bricolé. La solidité technique **est** la condition de la confiance.

> *« La solidité technique n'est pas un luxe d'ingénieur. C'est ce qui permet à Guillaume de faire confiance à un système qui se souvient à sa place. »*
