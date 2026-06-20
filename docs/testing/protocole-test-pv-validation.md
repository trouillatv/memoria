# Protocole de test terrain — Écran « Points à confirmer avant le PV »

**But du test :** savoir si cet écran est **adopté ou ignoré** par un vrai utilisateur, AVANT d'écrire une ligne de plus. La prochaine décision produit doit venir du terrain, pas du code.

> Règle d'or de la session : **1 h de test > 10 h de dev.** Ne pas défendre l'écran, ne pas l'expliquer. Observer.

---

## 1. Ce qu'on teste vraiment (pas la technique)

L'écran parie sur une chose : que l'utilisateur veut une réponse à **« qu'est-ce qui m'empêche d'envoyer mon PV ? »**, puis **agir** (corriger), pas analyser.

On NE teste PAS : les resolvers, le gate, la politique de blocage, l'audit. Tout ça est invisible pour l'utilisateur — et c'est volontaire.

**La phrase qui valide tout :** un conducteur de travaux qui dit, sans qu'on l'y pousse, *« ça, ça corrige direct le chantier »*. La phrase qui invalide : *« je connais déjà ces infos, pourquoi je dois cliquer ? »*.

---

## 2. Testeurs (1 à la fois, 15–20 min chacun)

| Profil | Angle | Réunion à ouvrir |
|---|---|---|
| **Émeline** (BECIB / MOE) | produit des PV pour de vrai | une réunion site avec ≥ 3 points actifs |
| **Adrien** (BTP, conducteur) | terrain pur, mobile | idem, sur téléphone si possible |
| **Guillaume** (AGP / pilotage) | continuité, mémoire | idem |

**Setup :** ouvrir une réunion réelle qui a des trous connus (responsable manquant, échéance, DNS absent). Être à côté, **silencieux**, chrono discret. Ne RIEN expliquer avant.

---

## 3. La consigne (mot pour mot, non guidée)

> « Tu sors de cette réunion de chantier. Produis-moi le compte-rendu. Fais comme si j'étais pas là, et dis tout haut ce que tu penses au fur et à mesure. »

Puis **on se tait.** On ne montre pas le bouton, on ne nomme pas « points à confirmer », on n'aide pas. Le seul moment où on parle : si la personne est bloquée > 30 s et le demande explicitement.

---

## 4. Observation silencieuse — à noter en direct

| Observation | Note |
|---|---|
| Temps avant le **1ᵉʳ geste utile** (clic Corriger / Compléter) | ____ s |
| Comprend le **🔴 / 🟠** sans explication ? | oui / non |
| Lit-il le **bandeau du haut**, ou plonge-t-il direct dans la liste ? | ____ |
| Clique-t-il **« Corriger maintenant »** ? | oui / non |
| Comprend-il que **Compléter corrige le chantier** (pas juste le PV) ? | oui / non / pas clair |
| Va-t-il voir **Traités / Suggestions** ? | jamais / regarde / utilise |
| À partir de **combien de points** décroche-t-il / soupire-t-il ? | ____ |
| Temps total jusqu'au PV généré | ____ min |
| **Verbatim** (citations exactes, surtout « génial » / « jamais ») | |

---

## 5. Questions APRÈS (jamais avant, jamais suggestives)

1. « Raconte-moi ce que cet écran fait, avec tes mots. » *(teste la compréhension du modèle)*
2. « Qu'est-ce que tu attendais et qui n'y était pas ? »
3. « Qu'est-ce qui t'a agacé / fait perdre du temps ? »
4. « Tu en ferais quoi : tu l'ouvrirais avant chaque PV, ou tu le sauterais ? »
5. « Si tu pouvais virer la moitié de l'écran, tu virerais quoi ? » *(teste l'hypothèse B)*

Ne JAMAIS demander « tu aimes ? » (réponse de politesse inutile). On veut des comportements et des manques, pas un avis.

---

## 6. Les 3 hypothèses — et comment les reconnaître

| Hypothèse | Signal pendant le test | Conséquence |
|---|---|---|
| **A — ils adorent** | corrige 2–3 points, génère, dit « pratique » spontanément | on continue (faux positif « pourquoi », écran synthèse) |
| **B — « juste les 3 trucs qui bloquent »** | ignore Traités/Suggestions/🟠, ne lit que le rouge | **on simplifie radicalement** (on enlève la moitié de l'écran) |
| **C — « pourquoi je dois cliquer ? »** | agacement, « je sais déjà », abandon | **on repense le workflow** (geste groupé, pré-rempli) |

Le résultat **le plus probable est B**. Et ce serait une **bonne nouvelle** : ça veut dire qu'on supprime, pas qu'on ajoute.

---

## 7. Verdict — succès / échec (à trancher par testeur)

**Succès** si, sans aide :
- comprend le 🔴 ⇒ **oui** ;
- produit le PV en **< 3 min** ;
- formule l'idée « ça corrige le chantier, pas juste le doc » (même maladroitement).

**Échec** si l'un de :
- il faut lui **expliquer** l'écran pour qu'il avance ;
- il **renonce** ou retourne à l'ancien moyen (Word à la main) ;
- il dit **« je ne m'en servirai pas »**.

**Zone grise** (= retravailler, pas jeter) : produit le PV mais en se plaignant du nombre de clics, ou ignore tout sauf le rouge → cap vers l'hypothèse B/C.

---

## 8. Après les 3 tests — quoi en faire

Remplir une ligne par testeur (verbatim compris), puis **une seule décision** :

- majorité **A** → reprendre la roadmap gelée ;
- majorité **B** → sprint « dégraissage » (enlever Traités/Suggestions/🟠 de la vue par défaut) ;
- majorité **C** → sprint « workflow » (un seul écran « corrige et génère », pré-rempli).

**Ne pas coder avant d'avoir cette ligne de décision.** C'est elle, pas une intuition, qui ouvre le prochain sprint.
