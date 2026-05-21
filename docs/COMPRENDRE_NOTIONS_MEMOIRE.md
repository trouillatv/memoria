# Comprendre les notions de mémoire de MemorIA — la théorie, simplement

> **Les concepts qu'on a inventés pour penser la mémoire.** Pas la technique (voir `COMPRENDRE_ARCHITECTURE.md`), pas le parcours (voir `COMPRENDRE_MEMOIRE_IA.md`), mais **les idées** : qu'est-ce qu'une mémoire qui vieillit, qu'est-ce que l'écho juste, pourquoi le silence est positif, c'est quoi les 7 primitives…
>
> Chaque notion : *« l'idée »* → *« pourquoi c'est important »* → *« comment ça se voit dans MemorIA »*.

---

## Pourquoi ces notions existent

La plupart des logiciels **stockent** de l'information. MemorIA fait plus : il **gère le cycle de vie de la mémoire humaine** — elle naît, elle vit, elle vieillit, elle se transmet, elle s'efface parfois.

Penser ça correctement a demandé d'**inventer un vocabulaire**. Ces notions ne sont pas du jargon académique — ce sont des outils pour prendre les bonnes décisions produit. Les voici, une par une.

---

## 1. La mémoire assistée à 3 couches

**L'idée** : toute information dans MemorIA passe par trois couches qui ne se mélangent jamais.

1. **L'artefact brut** — la trace originale (photo, note vocale, signalement). **Jamais supprimée.**
2. **L'IA propose** — elle suggère des liens, des échos, des interprétations.
3. **L'humain valide** — il garde ou écarte. C'est lui qui tranche.

> **Analogie** : un assistant qui te prépare des dossiers. Il rassemble les pièces (artefact), te dit « ça pourrait être lié à ça » (IA propose), mais c'est **toi** qui décides ce qui entre au dossier final (humain valide).

**Pourquoi c'est important** : ça interdit à MemorIA de **dire la vérité à ta place**. L'IA ne décrète jamais ; elle suggère. Tu restes maître.

**Comment ça se voit** : les résonances disent « ça pourrait être lié, à vérifier », jamais « c'est lié ». Tu peux toujours écarter.

---

## 2. L'écho juste, pas la vérité

**L'idée** : quand l'IA fait remonter un souvenir, on ne juge pas s'il est *« vrai »*. On juge s'il est un **« écho juste »** — une continuité plausible que tu reconnais.

> **Analogie** : quand un ami te dit *« ça me rappelle ce qui s'est passé l'an dernier »*, tu ne lui demandes pas de prouver que c'est scientifiquement exact. Tu sens si l'écho est juste ou à côté de la plaque.

**Pourquoi c'est important** : la mémoire n'est pas une science exacte. Forcer l'IA à être « vraie » la rendrait soit muette (par prudence), soit menteuse (par excès de confiance). « Écho juste » est le bon niveau d'exigence.

**Comment ça se voit** : un écho peut être *factuellement partiel* mais *juste* (il fait recroiser deux choses utiles). À l'inverse, un écho peut être *exact* mais *inutile* (hors-contexte). On vise le juste, pas l'exact.

---

## 3. Le jury à 4 classes

**L'idée** : pour juger la qualité d'un écho que l'IA propose, on le classe dans **4 catégories**, jamais en binaire bon/mauvais.

| Classe | Description | Ce qu'on fait |
|---|---|---|
| **Écho juste** | Continuité utile | On garde |
| **Parasite** | Du bruit, faux positif | On renforce les filtres |
| **Trop vague** | Vrai mais inutilisable | On affine |
| **Dangereux** | Pourrait égarer une décision | On exclut strictement |

> **Analogie** : un jury de dégustation qui ne dit pas juste « bon / pas bon », mais « trop salé », « manque de cuisson », « parfait », « immangeable » — chaque verdict mène à une correction **différente**.

**Pourquoi c'est important** : un simple « ça marche / ça marche pas » ne dit pas **comment corriger**. Les 4 classes pointent chacune vers un réglage précis.

---

## 4. Le silence positif

**L'idée** : **quand il n'y a rien d'utile à dire, MemorIA se tait.** Pas de carte « tout va bien », pas d'alerte « aucune anomalie ». L'absence parle.

> **Analogie** : un bon majordome ne te récite pas tout ce qui va bien dans la maison. Il ne parle que quand quelque chose mérite ton attention. Son silence est une information : tout est sous contrôle.

**Pourquoi c'est important** : un système qui parle tout le temps **désensibilise**. Si MemorIA t'envoie 20 notifications par jour dont 19 inutiles, tu ignoreras la 20ᵉ qui était cruciale. Le silence rend chaque signal précieux.

**Comment ça se voit** : si la zone vigilance du dashboard est vide, elle ne s'affiche pas. Si aucune passation n'est à préparer, le widget continuité disparaît. Le vide est voulu.

---

## 5. La philosophie de l'oubli (la mémoire qui vieillit)

**L'idée** : **MemorIA n'oublie jamais vraiment, mais il sait mettre en sommeil.** Une information ancienne ne disparaît pas — elle s'efface des surfaces actives tout en restant consultable.

> **Analogie** : ton cerveau. Tu n'as pas oublié ce que tu as mangé il y a 3 ans, mais ça ne te vient plus spontanément à l'esprit. C'est rangé, pas effacé. Si on te le demande, tu peux le retrouver.

**Pourquoi c'est important** : sans oubli, la mémoire devient **toxique**. Si Joseph reçoit un brief avec 38 anomalies dont 80% sont vieilles ou résolues, il conclut *« ce site est un enfer »* — alors qu'il va très bien aujourd'hui.

**Trois mécanismes** :
1. **Décroissance temporelle** — une anomalie de plus de 90 jours sort des briefs (reste consultable sur la fiche)
2. **Résolution explicite** — un humain marque une anomalie « résolue », elle quitte la mémoire vive
3. **Supersession** — un document en remplace un autre, l'ancien passe en arrière-plan

**La phrase** : *« MemorIA n'est pas un disque dur, c'est un cerveau collectif. Il se souvient, il oublie, il actualise. »*

---

## 6. Le temps mémoriel (les 5 états)

**L'idée** : dans MemorIA, une information n'est pas juste « là » ou « pas là ». Elle a un **état temporel** parmi cinq.

| État | Sens | Exemple |
|---|---|---|
| **Présent actif** | Peut surgir maintenant | Anomalie de la semaine |
| **Atténuation** | Encore là, en arrière-plan | Anomalie de 4 mois (grisée) |
| **Archive accessible** | Ne surgit plus, consultable | Intervention de 2024 |
| **Snapshot figé** | Cristallisé à un instant T | Un brief de passation, un AO clôturé |
| **Supersession** | Remplacé par autre chose | Ancien plan d'accès → nouveau |

> **Analogie** : ta boîte mail. Il y a les mails du jour (présent actif), ceux de la semaine dernière qu'on voit encore mais en bas (atténuation), les archives (consultables si tu cherches), les mails « épinglés » figés (snapshot), et ceux remplacés par un fil plus récent (supersession).

**Pourquoi c'est important** : ça donne à MemorIA un **temps propre**, différent du temps de l'application. La mémoire n'est pas un débarras plat — elle a une profondeur temporelle. Et ça s'explique en une slide à un client.

---

## 7. La discipline d'apparition

**L'idée** : une fois qu'on peut faire surgir de la mémoire **partout**, le danger n'est plus « est-ce qu'on peut ? » mais « **est-ce qu'on devrait ?** ». Avant de faire apparaître une mémoire, on passe **4 questions**.

1. Y a-t-il une **vraie incertitude** humaine à ce moment ?
2. L'absence de cette mémoire causerait-elle une **erreur concrète** ?
3. La personne peut-elle **agir** sur ce qu'on lui montre ?
4. Le moment est-il **rare** ?

Si une seule réponse est « non », **on ne fait pas apparaître**.

> **Analogie** : un bon médecin ne te bombarde pas de toutes tes analyses. Il te dit ce qui change quelque chose à ta décision, maintenant. Le reste, il le garde pour si tu poses la question.

**Pourquoi c'est important** : c'est le rempart contre la **surconstruction** — le risque que MemorIA devienne un système total, bavard, anxiogène. C'est *« le sujet des 12 prochains mois »*.

---

## 8. La qualité d'apparition (la grille à 6 dimensions)

**L'idée** : la discipline d'apparition décide **si** une mémoire apparaît. La qualité d'apparition décide **comment** — sur 6 réglages.

| Dimension | Question |
|---|---|
| **Quand** | À quelle fréquence ? (trop souvent = mobilier) |
| **Comment** | Bandeau ? encart ? lecture discrète ? |
| **Intensité** | Couleur, taille, position |
| **Urgence** | Rouge critique ou sobre ? |
| **Confiance** | « C'est » vs « ça pourrait être » |
| **Fatigue** | Combien d'autres choses parlent déjà dans la session ? |

> **Analogie** : un orchestre. Ce n'est pas juste « jouer ou pas jouer ». C'est aussi : quel instrument, quel volume, à quel moment, combien de temps. Trop d'instruments en même temps = cacophonie.

**Pourquoi c'est important** : deux mémoires également pertinentes ne doivent pas apparaître de la même façon. Une deadline AO = rouge en haut. Un écho de contexte = gris discret. Mal calibrer, c'est soit alarmer pour rien, soit noyer l'important.

---

## 9. Les 7 primitives produit

**L'idée** : MemorIA n'est pas une collection de features. C'est **7 mécaniques de base** qui se recombinent. Chacune est réutilisable dans n'importe quel secteur.

1. **Mémoire** — capturer et garder les traces
2. **Oubli** — savoir mettre en sommeil
3. **Transmission** — passer la mémoire à quelqu'un d'autre
4. **Récence** — savoir ce qui est récent vs ancien
5. **Passation** — organiser la bascule entre humains
6. **Limites humaines** — ne pas saturer (discipline d'apparition)
7. **Garde-fous** — empêcher les dérives (RH, surveillance)

> **Analogie** : les briques LEGO. Tu n'achètes pas « un château » ou « un vaisseau » — tu achètes des briques qui se recombinent en mille choses. Les 7 primitives sont les briques de la continuité opérationnelle.

**Pourquoi c'est important** : c'est ce qui rend MemorIA **réutilisable au-delà du nettoyage**. Le passage de témoin (composition de Transmission + Passation + Garde-fous) marche aussi pour les hôpitaux, la sécurité, le BTP. On ne refait pas le produit — on recompose les briques.

---

## 10. La continuité opérationnelle

**L'idée** : le vrai problème que MemorIA résout n'est pas « mieux gérer le nettoyage ». C'est : **« quand les humains changent, la mémoire opérationnelle disparaît ».**

> **Analogie** : une équipe de relais. Si le coureur qui passe le témoin le lâche, toute la course est perdue, peu importe la vitesse des coureurs. MemorIA, c'est le système qui garantit que le témoin ne tombe jamais.

**Pourquoi c'est important** : ce problème est **universel** — hôpitaux (soignants qui tournent), sécurité (agents qui changent), BTP, hôtels, collectivités. Partout où des humains opèrent des lieux qu'ils ne possèdent pas. MemorIA n'est pas un SaaS nettoyage — c'est un **système de continuité**, validé d'abord sur le nettoyage.

**La phrase** : *« Quand les humains changent, la mémoire continue. »*

---

## 11. Le risque des deux morts opposées

**L'idée** : MemorIA peut mourir de **deux façons contraires**. Le travail produit est de rester **exactement au milieu**.

| Mort | Symptôme |
|---|---|
| **Sous-intelligence** | Ressemble à un logiciel banal → remplacé par un ERP |
| **Surconstruction** | Trop bavard, anxiogène → étiquette « flicage », rejet |

> **Analogie** : assaisonner un plat. Pas assez de sel = fade, personne n'en veut. Trop de sel = immangeable, personne n'en veut. Le bon cuisinier vise le point précis du milieu.

**Pourquoi c'est important** : la plupart des projets n'ont qu'une mauvaise direction à éviter. MemorIA en a **deux opposées**. C'est plus difficile — toute dérive d'un côté ou de l'autre est fatale. D'où l'importance d'**observer** (le dashboard d'observation pilote) pour détecter les dérives tôt.

---

## 12. L'apparition adaptative (la suite, pas encore construite)

**L'idée** : demain, MemorIA pourrait **ajuster ce qu'il montre selon ton comportement observé**. Si tu ignores toujours les vieilles anomalies mais ouvres toujours les passations, il réduirait les vieilles anomalies et mettrait les passations en avant.

> **Analogie** : un bon libraire qui te connaît. À force de te voir, il sait ce qui t'intéresse et ce qui t'ennuie. Il te présente d'abord ce qui compte pour toi — mais il peut t'expliquer pourquoi, et tu peux toujours lui dire « non, montre-moi tout ».

**Le verrou non-négociable** : *« pas d'IA noire »*. L'adaptation doit être **explicable** (« tu as ignoré ça 8 fois sur 10, je le mets en retrait »), **réversible** (tu peux réactiver), **auditée**. Jamais une optimisation d'engagement type réseaux sociaux qui décide en secret.

**Pourquoi c'est différé** : ça a besoin de **données comportementales** qui n'existent pas encore. On doit d'abord observer Guillaume en vrai pendant le pilote. Construire ça maintenant, ce serait l'optimiser pour un comportement imaginé.

**La question qui résume tout** : *« Quelle mémoire mérite d'apparaître maintenant ? »* — pertinente, pour cette personne, à ce moment, vu ce qu'elle a montré comme utile, sans la saturer.

---

## En une image — comment tout s'emboîte

```
        L'artefact est capturé (mémoire assistée, couche 1)
                          ↓
        L'IA propose un écho (couche 2) — jamais "la vérité"
                          ↓
        Le jury 4 classes filtre la qualité de l'écho
                          ↓
        La discipline d'apparition décide SI ça surgit
                          ↓
        La qualité d'apparition décide COMMENT ça surgit
                          ↓
        L'humain valide ou écarte (couche 3)
                          ↓
        Avec le temps : la mémoire vieillit (oubli),
        change d'état (temps mémoriel), se transmet (passation)
                          ↓
        Le tout reste au centre (ni banal, ni anxiogène)
        et un jour, s'adaptera au comportement observé
```

**La conviction de fond** : une mémoire qui ne sait pas se taire, vieillir, et se transmettre n'est pas une mémoire — c'est un débarras. MemorIA est construit pour ne jamais devenir un débarras.

---

*Triptyque complet : `COMPRENDRE_ARCHITECTURE.md` (les briques techniques) · `COMPRENDRE_MEMOIRE_IA.md` (le parcours vécu) · ce document (les concepts de mémoire) · `MODE_EMPLOI.md` (l'usage quotidien).*
