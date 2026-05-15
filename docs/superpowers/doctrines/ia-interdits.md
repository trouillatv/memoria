# Doctrine IA — Interdits permanents

> Ce document est un garde-fou, pas une liste de features refusées.
> Il existe parce que la pression d'ajouter sera toujours plus forte que la pression de retirer.
> Chaque interdit ici a une raison. La raison compte autant que la règle.

---

## Principes fondateurs

**La mémoire brute prime toujours sur l'interprétation.**

- La photo prime sur sa légende générée.
- L'audio prime sur sa transcription.
- Le document prime sur son résumé.
- La trace brute prime sur la lecture IA.

L'IA ne remplace pas la donnée. Elle la révèle. Si la révélation contredit la donnée, c'est la révélation qui est fausse.

**L'IA ne remplace jamais une trace.**

Supprimer, cacher ou écraser une donnée source par son interprétation est interdit — même si l'interprétation est "meilleure", plus courte, ou plus lisible. La confiance profonde du système vient de la permanence du brut. L'IA relie et révèle. Elle ne se substitue pas à la réalité.

**Une lecture IA doit pouvoir être ignorée sans friction.**

Aucune lecture ne demande une action. Aucun acquittement. Aucune confirmation. Guillaume lit ou ignore — les deux sont également valides. Dès qu'une lecture génère une obligation de réponse, le produit bascule de contemplatif à autoritaire. Cette bascule est irréversible.

---

## Interdits permanents

### Sur les humains

❌ **Ranking agents** — aucun classement, aucun score de performance individuel, jamais.  
❌ **Scoring humain** — pas de note, pas d'évaluation automatique d'une personne ou équipe.  
❌ **Génération émotionnelle** — pas d'adjectifs sur les gens ("motivé", "en difficulté", "régulier").  
❌ **Attribution causale** — ne jamais relier une anomalie à une personne nommée. L'IA parle des lieux, pas des gens.

*Pourquoi* : ces données alimenteront un jour une décision RH. Le système ne doit jamais être citable dans un licenciement, un avertissement, ou une évaluation annuelle.

---

### Sur le rendu

❌ **Feed IA bavard** — pas de flux continu de lectures. Chaque fragment doit mériter son apparition : il révèle ce que l'humain ne voit pas seul.  
❌ **Alertes agressives** — pas de rouge, pas de notification push IA, pas de bannière "attention".  
❌ **Recommandations automatiques** — pas de "vous devriez", "pensez à", "il faudrait". L'IA constate, jamais ne prescrit.  
❌ **Scores silencieux** — pas de jauges, pas de %, pas de barres de progression IA. Ces formes visuelles impliquent un verdict.

*Pourquoi* : la magie actuelle vient du faible volume + forte pertinence. Passer de 1-2 lectures rares à 12 insights partout transforme le produit en dashboard. La rareté est une fonctionnalité.

---

### Sur l'architecture

❌ **Assistant conversationnel permanent** — pas de chatbot, pas de "demandez à l'IA", pas d'interface question-réponse intégrée au flux terrain.  
❌ **Auto-détection sans seuil explicite** — chaque signal IA doit avoir un seuil codé, documenté, modifiable. Pas de boîte noire.  
❌ **Suppression du brut par l'IA** — le résumé ne remplace pas le document. La transcription ne remplace pas l'audio. Toujours accès à la source.  
❌ **Prédiction RH ou organisationnelle** — pas de modèle prédictif sur les équipes, les absences humaines, les performances futures.

*Pourquoi* : ces architectures détruisent la confiance quand elles se trompent. Et elles se trompent toujours sur les bords.

---

### Sur les LLM

❌ **LLM comme narrateur** — le LLM ne raconte pas, ne synthétise pas ce que l'humain doit ressentir.  
❌ **LLM dans les lectures de lieu** — jamais de fragment cockpit ou mobile généré par LLM. Ces surfaces sont déterministes ou sémantiques, pas génératives.  
❌ **LLM sans validation humaine** — tout output LLM exposé à un client ou décideur doit passer par une validation humaine avant envoi.

*Pourquoi* : "Nous avons détecté une tendance préoccupante liée à l'humidité persistante du bloc B" détruit en une phrase tout ce que le produit a construit. Le consultant GPT tue la magie.

---

## Les bons usages LLM (plus tard, dans cet ordre)

Ces usages sont autorisés parce qu'ils sont de la **transformation documentaire**, pas de la **perception contextuelle**.

1. **AO / Appels d'offres** — extraction, structuration, résumé de documents administratifs longs. L'humain valide le résultat avant usage.
2. **Litiges client** — synthèse chronologique d'un dossier de preuves pour un usage juridique ou contractuel. Brut toujours accessible.
3. **Rapport mensuel exportable** — court, sobre, validable par le superviseur avant envoi.

Dans ces trois cas : sobre, court, brut toujours accessible, validation humaine avant diffusion.

---

## Test de légitimité d'une lecture IA

Avant d'afficher un fragment, une question :

> **"Guillaume aurait-il pu voir ça lui-même en parcourant les données brutes ?"**

- Si oui → ne pas montrer. C'est de la reformatage.
- Si non → montrer. C'est de la révélation.

---

## Ce document

Ce document ne change pas par feature request ou par envie d'enrichir.  
Il change si une règle s'avère fausse sur le terrain — après observation, avec une raison explicite.  
Toute modification doit être journalisée dans `10_JOURNAL_DECISIONS.md`.
