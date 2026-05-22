# Comprendre la mémoire + l'IA de MemorIA — ce qui se passe vraiment

> **Le parcours vécu, étape par étape.** Pas les briques techniques (voir `COMPRENDRE_ARCHITECTURE.md` pour ça), mais ce qui se passe **concrètement** quand tu charges un PDF, cliques « Analyser », ou qu'une résonance apparaît.
>
> Répond aux 10 questions : que se passe-t-il à l'upload ? c'est quoi un embedding ? le bouton Analyser ? les résonances ? la mémoire AO ? le coût ? etc.

---

## L'analogie de départ

MemorIA, c'est **un bibliothécaire avec une mémoire photographique du terrain**. Il ne lit pas juste les documents — il se souvient de tout ce que tes équipes ont vécu, et il sait dire *« tiens, ça me rappelle quelque chose »* au bon moment.

Tout repose sur **une seule idée** : transformer du texte en **empreinte de sens** (un *embedding*), pour comparer des choses **par leur signification**, pas par leurs mots exacts.

---

## 1. Quand on charge un PDF dans la bibliothèque

Tu déposes un CCTP de 40 pages. Voici ce qui se passe, dans l'ordre :

**Étape 1 — Stockage du fichier brut.** Le PDF est rangé tel quel (Supabase Storage). On ne le touche pas. C'est l'original, conservé pour toujours. Comme l'archive papier dans un classeur.

**Étape 2 — Extraction du texte.**
- PDF texte (généré par Word) → lecture directe, instantanée, gratuite.
- PDF scanné (photo de papier) → **OCR** (reconnaissance de caractères) qui « lit » l'image. *(C'est ce qu'on a fait sur ton PDF ChatGPT de 382 pages : c'étaient des captures d'écran, donc OCR via Gemini.)*

**Les images dans le document** : on extrait **le texte**. Les photos/schémas internes ne sont pas analysés visuellement. On garde le texte, pas le sens des images.

**Étape 3 — Découpage en chunks.** On découpe le document en **morceaux** de quelques paragraphes (les *chunks*). Pourquoi ? Un document de 40 pages parle de 15 sujets. Si on cherche « protocole désinfection », on veut **le bon paragraphe**, pas tout le PDF.

> Analogie : déchirer un livre en fiches bristol, une idée par fiche.

**Chaque mot est-il gardé ?** Oui — le texte de chaque chunk est conservé intégralement en base. On ne perd rien du texte (juste la mise en page et les images).

**Étape 4 — L'empreinte de sens.** Pour chaque chunk, on calcule son *embedding* (voir §2).

**Stocké en base, au final** :
- Le **document** (métadonnées : type, dates, visibilité, qui l'a chargé)
- Les **chunks** (texte de chaque morceau)
- L'**embedding** de chaque chunk (768 nombres)
- Les **liens** vers les entités (ce document → ce site, ce contrat)

---

## 2. Les embeddings — expliqués simplement

C'est le cœur de tout.

On prend un bout de texte, et un modèle d'IA (`gemini-embedding-001`) le transforme en **une liste de 768 nombres**. Ces 768 nombres = une « position » dans « l'espace du sens ».

> **Analogie** : des coordonnées GPS. Avec 2 nombres (latitude, longitude) tu places un point sur Terre, et deux villes proches ont des coordonnées proches. Un embedding, c'est pareil mais avec **768 nombres** pour placer un texte dans l'espace du sens.

**La magie** : deux textes qui **veulent dire la même chose** se retrouvent **proches**, même **sans mots communs**.

Exemple — ces trois phrases :
- *« PC sécurité bloqué »*
- *« accès SAS fermé »*
- *« porte impossible à ouvrir »*

**Aucun mot en commun.** Une recherche par mots-clés (Ctrl+F) ne les rapprocherait jamais. Mais leurs **empreintes sont proches** — le modèle a « compris » qu'elles parlent toutes du même problème : un accès physique bloqué.

**Calculé une fois vs à chaque recherche** :
- L'embedding d'un chunk = calculé **une seule fois** à l'upload. Stocké. Jamais recalculé.
- À chaque recherche, on calcule juste l'embedding de **la question** (un seul petit texte) et on compare aux empreintes stockées.

**pgvector** = l'extension de la base qui stocke ces 768 nombres et **trouve très vite les plus proches**. Sans elle, comparer à 50 000 chunks serait lent. Avec, c'est instantané.

---

## 3. Cartographie de tous les objets mémoire

| Objet | C'est quoi | Exemple |
|---|---|---|
| **Document brut** | Le PDF original, intact | Le CCTP de 40 pages du CHT |
| **Chunk** | Un morceau de texte du document | Le paragraphe « protocole désinfection » |
| **Embedding** | L'empreinte de sens d'un chunk (768 nombres) | La « position » du paragraphe dans l'espace du sens |
| **knowledge_chunk** | Un chunk **documentaire** + embedding, au niveau **entreprise** | Tout ce qui vient des documents/AO |
| **trace terrain** | Une mémoire **vécue** + embedding, au niveau **site** | La note vocale de Joseph « PC sécurité bloqué » |
| **résonance** | Un **pont** entre une trace terrain et un chunk documentaire | « Cette note fait écho au protocole d'accès du CCTP » |
| **mémoire AO** | L'historique des AO passés + leurs résultats | « AO bio-nettoyage 2025, perdu sur le prix » |
| **analyse IA** | Le travail des 6 agents sur un AO | Le rapport du Contradicteur |

**La distinction clé** :
- **trace terrain** = mémoire **vécue** (notes, photos, anomalies), attachée à **un site**
- **knowledge_chunk** = mémoire **documentaire** (CCTP, protocoles, AO), attachée à **l'entreprise**

Ces deux mémoires vivent dans des **silos séparés** (sécurité, contrôle d'accès). La **résonance** est le pont qui les fait dialoguer.

---

## 4. Le bouton « Analyser »

Quand tu cliques « Analyser » sur un AO :

**Ce qui se lance** :
1. **Extraction** du texte (OCR si scan) — coût quasi nul
2. **Découpage** en chunks + **embeddings** — centimes
3. **Les 6 agents IA** travaillent, chacun son rôle :
   - Lecteur AO → contraintes, risques, checklist
   - Stratège → angle commercial
   - Terrain → faisabilité opérationnelle
   - Financier → marge, risque de sous-chiffrage
   - Contradicteur → attaque le dossier
   - Mémoire technique → rédige un brouillon

**Ce qui coûte de l'IA (cher)** : le travail des 6 agents (appels à un gros modèle génératif). ~5-10 F par AO complet. C'est **là** que va l'essentiel du coût.

**Ce qui coûte presque rien** : extraction, embeddings, recherche de précédents (comparaison de nombres).

**Ce qui est persisté** : les analyses des agents, les chunks + embeddings, les sources citées (`[doc:id]` cliquables).

**Ce qui est réutilisé gratuitement** : **tout**. Rouvrir l'AO demain → on **ne relance pas** les agents, on affiche le stocké. Zéro coût.

**Ce qui est recalculé** : rien, sauf clic explicite « Relancer l'analyse ». **On ne paie l'IA qu'une fois, sur action explicite.**

---

## 5. Résonances B1 / B2 — et la vérité sur le « 0.80 »

**Comment naît une résonance** : quand un site a accumulé des traces ET qu'un document y est rattaché, MemorIA cherche si un paragraphe du document fait écho à une mémoire terrain.

**Deux mécanismes** :

**B1 — déterministe (zéro IA).** Pur lien logique. Si un document est explicitement rattaché à un site, on génère une lecture : « nouveau plan d'accès ajouté ». Aucune IA, aucun calcul de sens. **100% explicable, 0% hallucination.**

**B2 — sémantique (comparaison d'empreintes).** On compare les embeddings. On cherche les paragraphes documentaires proches d'une trace terrain.

Exemple : Joseph note *« PC sécurité bloqué »*. Le CCTP contient *« procédure d'accès au poste de contrôle sécurité »*. Mots différents, **empreintes proches** → résonance : « cette note pourrait être liée à la procédure d'accès — à vérifier ».

**Le cosine** : quand on compare deux empreintes (deux flèches dans l'espace du sens), on mesure **l'angle** entre elles.
- Cosine = 1 → même direction → sens identique
- Cosine = 0 → perpendiculaire → aucun rapport

**Le « 0.80 » — la subtilité.** Tu as probablement vu `2.0 * (1.0 - 0.60) = 0.80` dans le code. C'est une confusion **distance vs similarité** :
- pgvector mesure une **distance** : 0 = identique, plus c'est grand plus c'est différent
- Nous raisonnons en **similarité** : 1 = identique, 0 = sans rapport
- Conversion : `similarité = 1 − distance/2`

> Une **similarité cible de 0.60** = une **distance maximale de 0.80**. Le « 0.80 » que tu as vu, c'est la distance ; la similarité visée est ~0.60. La même chose vue à l'envers.

**Le vrai seuil** : similarité ~**0.55 à 0.60** selon le contexte.

**Pourquoi ce niveau** :
- Trop haut (0.85) → on ne matche que des quasi-copies → on rate les vrais échos
- Trop bas (0.40) → on matche n'importe quoi → bruit, hallucinations
- ~0.60 = le point d'équilibre observé

**Doctrine** : *« un cosine n'est pas un fait »*. Ce seuil est un **curseur ajustable**, pas une vérité gravée. On le règle selon ce qu'on observe.

**Pourquoi parfois ça ne matche pas** : même au-dessus du seuil, une résonance peut être **bloquée par les filtres** (un document « accès » ne doit matcher que des traces sécurité/badge, pas du nettoyage). Le sens proche ne suffit pas.

**« Écho juste » vs « vérité »** : une résonance ne dit **jamais** « c'est vrai ». Elle dit « ça pourrait être lié, à vérifier ». Joseph regarde et dit « bien vu » (écho juste) ou « rien à voir » (parasite). Le système propose, l'humain tranche.

---

## 6. Mémoire AO

**Comment un AO retrouve ses précédents** : on calcule son empreinte et on cherche les AO passés dont l'empreinte est proche — donc du même type, même formulés différemment.

**Comment les documents sources sont rappelés** : via les liens explicites + la proximité sémantique. On remonte les protocoles, certifications, fiches pertinents pour CE type d'AO.

**Juste du retrieval (recherche, gratuit)** : retrouver les AO similaires, les documents pertinents, le capital client (compteurs), la note vocale de closing du dernier AO similaire.

**De l'analyse IA (coûteux, sur action)** : le travail des 6 agents, la génération de mémoire technique.

**Stocké durablement** : l'AO + embedding, son outcome (gagné/perdu + raison + tag), la note vocale + transcription, les analyses des agents.

C'est **cumulatif** : chaque AO clôturé enrichit la mémoire commerciale pour le suivant.

---

## 7. Ce qui se passe dans le temps

**Comment la mémoire grandit** : chaque intervention, photo, note vocale, anomalie devient une trace terrain avec son empreinte. La mémoire d'un site s'épaissit à l'usage.

**Ce qui est vivant** : traces récentes (< 90 jours), « À savoir » actifs, anomalies ouvertes, documents en statut actif.

**Ce qui devient obsolète** (la mémoire qui vieillit) :
- Anomalie > 90 jours → sort des briefs (reste consultable)
- Anomalie **résolue** par un humain → disparaît de la mémoire vive
- Document remplacé → passe en arrière-plan

**Comment le terrain influence le futur** : Joseph note « le SAS B est en travaux ». Cette trace est embeddée. Le mois prochain, un AO ou un brief concernant ce site **peut la faire ressortir**. Le terrain d'aujourd'hui nourrit le contexte de demain.

**Comment un nouveau document change les futures résonances** : dès qu'on charge un protocole, ses chunks sont embeddés. À partir de là, **toutes les traces terrain (passées et futures) peuvent résonner avec lui**. La mémoire n'est pas figée — chaque ajout enrichit le réseau de connexions.

---

## 8. Ce qui est réellement « intelligent » (la vérité crue)

Beaucoup de ce qui paraît « magique » est en fait **très simple**.

| Mécanisme | Type | Magique ? |
|---|---|---|
| Les 6 agents AO, mémoire technique | **IA générative** (vrai LLM) | Oui — vraie génération |
| Résonances B2, AO similaires, recherche sémantique | **Recherche vectorielle** (maths) | Paraît magique, c'est des nombres |
| Résonances B1, « document rattaché au site » | **Règles métier** (liens logiques) | Non — du SQL |
| Filtres (type, target, domaine) | **Règles métier** | Non |
| Décroissance 90j, cap sites, silence positif | **Heuristiques** (seuils) | Non |
| Compteurs, capital client, pipeline | **Simple SQL** (COUNT, GROUP BY) | Non du tout |

**Le point honnête** : ce qui donne l'impression « il a compris » (les résonances), ce n'est **pas** de l'IA générative. C'est de la **comparaison d'empreintes** — des maths sur des listes de nombres. Moins « intelligent » qu'il n'y paraît, mais **fiable et pas cher** : pas d'hallucination possible, juste de la proximité mesurée.

L'IA générative (chère, faillible) est **confinée** à un seul endroit : l'Atelier AO, sur ton action.

---

## 9. Le coût réel

**Ce qui coûte cher** : les agents génératifs (Atelier AO, mémoire technique) → ~5-10 F par AO complet. Le seul vrai poste de coût.

**Ce qui coûte presque rien** : embeddings (~0,001 F par document), recherche vectorielle (gratuite), tout le reste (SQL, affichage).

**Pourquoi on pré-calcule** : on calcule les embeddings **une fois** à l'upload, en arrière-plan. Au moment où on en a besoin, c'est déjà prêt et gratuit. On ne paie jamais deux fois.

> Analogie : les mises en place du matin en cuisine. Au coup de feu, tout est prêt.

**Pourquoi on refuse les « LLM live partout »** : si chaque page demandait à un gros modèle de réfléchir à chaque ouverture, le coût exploserait (et ce serait lent, et faillible). Doctrine : **pré-calcul async + recherche bornée**, jamais LLM live en arrière-plan permanent. L'IA chère ne se déclenche **que** sur action explicite.

---

## 10. La philosophie globale — ce que MemorIA est devenu

**Les couches, de bas en haut** :
1. **Capture** — le terrain dépose des traces
2. **Empreinte** — chaque trace et document reçoit son embedding
3. **Silos** — mémoire terrain (par site) + documentaire (par entreprise)
4. **Ponts** — les résonances relient les deux par le sens
5. **Composition** — passation, AO, continuité recomposent ces mémoires au bon moment
6. **Discipline** — l'oubli, le silence positif, les filtres empêchent le bruit
7. **Génération** — l'IA générative, confinée à l'Atelier AO, produit du livrable sur demande

**MemorIA vs un chatbot** : un chatbot **génère** une réponse à chaque question (cher, faillible, sans mémoire durable). MemorIA **se souvient** et **fait résonner** — il ne génère presque jamais. Il **contextualise**, il ne fabrique pas.

**MemorIA vs un drive documentaire** : un drive **range** des fichiers (tu dois savoir quoi chercher). MemorIA **fait remonter** la bonne mémoire au bon moment, **sans que tu la cherches** — quand un AO arrive, quand quelqu'un reprend un site, quand un contrat se termine.

**La phrase qui résume tout** :

> Un drive te donne ce que tu **demandes**.
> Un chatbot te donne ce qu'il **invente**.
> **MemorIA te donne ce dont tu ne savais pas que tu avais besoin de te souvenir — au moment exact où ça compte.**

---

## Les documents qui dorment : tous ne méritent pas la mémoire

La plus grosse réserve de mémoire d'une entreprise est **déjà là** — dispersée, oubliée, morte : plans, procédures, comptes-rendus, audits, devis, mails PDF. Elle existe, mais elle n'est **jamais reliée au contexte opérationnel**.

MemorIA sait importer ces documents. Mais il refuse le piège du « on vectorise tout » :

> [!DANGER] Le piège du cimetière de PDFs
> Importer 1000 PDF et tout « embedder » produit du **bruit**, des contradictions, une recherche molle et des coûts qui explosent. MemorIA deviendrait un « ChatPDF géant » — la mort du positionnement.

La vraie question n'est pas *« peut-on indexer ce document ? »* mais **« nourrit-il la mémoire vivante ? »**. D'où **3 couches** :

- 🟢 **Mémoire vivante** — procédures, accès, sécurité, incidents : transformables en savoir opérationnel (un « à savoir » lié au lieu).
- 🔵 **Mémoire consultable** — contrats, AO, références : indexés, retrouvables par le sens.
- ❄️ **Archive froide** — factures, preuves, vieux documents : on les garde, **on ne les indexe pas**.

> [!IMPORTANT] L'humain garde la main
> À l'import, MemorIA **propose** la couche et l'indexation pour chaque document, **et explique pourquoi**. L'humain valide. Rien de magique, rien de caché — c'est la même doctrine partout : *l'IA propose, l'humain arbitre*.

C'est ce qui transforme MemorIA d'un « outil de terrain » en **système de continuité opérationnelle** : le document dormant devient mémoire utile, au moment où elle compte.

---

*Document compagnon : `COMPRENDRE_ARCHITECTURE.md` (les briques techniques) · `MODE_EMPLOI.md` (l'usage quotidien).*
