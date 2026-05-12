# Registre des refus produit — NetoIAge

> **Mémoire collective des features refusées par construction.**
> Source : doctrine V3 (cf. `planning-doctrine.md`).
> Vivant : chaque demande refusée s'inscrit ici avec date, contexte, motif.

---

## Pourquoi ce registre

Une doctrine ne survit que si elle est **opposable**. À 6-12 mois, un nouveau dev / un nouveau commercial / un nouveau client va proposer une feature qui a déjà été refusée. Sans mémoire, le débat repart de zéro et l'usure du temps finit toujours par gagner.

Ce registre sert à :
1. **Citer un refus précédent** quand la même demande revient.
2. **Documenter les motifs** doctrinaux (pas juste « non »).
3. **Convertir le refus en argument de vente** : « Voici ce que NetoIAge ne fera jamais — c'est ce qui rend nos preuves opposables. »

**Règle d'usage** : toute demande refusée pour motif doctrinal atterrit ici, avec un lien vers la discussion (issue, slack, mail, conversation Claude). Pas de refus oral non documenté.

---

## Format d'entrée

```
### YYYY-MM-DD — Titre court de la demande
**Demandeur** : (interne / client / dev / prospect)
**Demande** : 1-3 lignes
**Refus** : 1-3 lignes (motif doctrinal explicite, citer la section de planning-doctrine.md)
**Argument client (si applicable)** : reformulation positive pour répondre poliment
**Lien** : (issue, slack, mail)
```

---

## Refus enregistrés

### 2026-05-12 — Lister les agents nommés dans l'export Excel /semaine/export

**Demandeur** : Vincent (interne, test doctrinal)
**Demande** : Ajouter une colonne « Agents » dans l'export Excel avec les noms des membres de chaque équipe affectée.
**Refus** : Viole l'asymétrie V3 (« Participants de X » oui, « X de Pierre » non). Un Excel nominatif circule par mail, devient un outil de surveillance individuelle hors plateforme. Doctrine V3 § Wording + § Hors-scope structurels.
**Argument client** : *« L'export contient l'équipe affectée et la cardinalité (4 personnes). Les identités précises sont dans le dossier de preuve de chaque intervention (`/p/[token]`), avec anonymisation par défaut et override admin justifié. C'est ce qui rend les preuves opposables sans devenir un outil RH. »*
**Lien** : Conversation Claude 2026-05-12 (session NetoIAge AGP).

---

### 2026-05-12 — Page profil agent `/users/[id]` ou `/agents/[id]`

**Demandeur** : Vincent (interne, test doctrinal)
**Demande** : Page profil utilisateur listant les interventions auxquelles un agent a participé.
**Refus** : Reverse lookup interdit V3 (asymétrie événement vs personne). La personne n'apparaît jamais comme sujet d'une vue. Seule exception : `/account` (l'utilisateur consulte SON propre compte). Doctrine V3 § Hors-scope structurels.
**Argument client** : *« NetoIAge documente les événements (interventions), pas l'activité des personnes. Une fiche agent serait une fiche RH déguisée. Pour les besoins légitimes (contact d'urgence, qualification), un champ profil simple suffit, sans page dédiée. »*
**Lien** : Conversation Claude 2026-05-12.

---

### 2026-05-12 — Filtre « intervenant » sur /preuves

**Demandeur** : Vincent (interne, test doctrinal)
**Demande** : Permettre de filtrer la liste des dossiers de preuve par agent participant.
**Refus** : Crée structurellement un reverse lookup. Même si techniquement faisable via la table `intervention_participants`, contredit l'asymétrie V3. La recherche /preuves se fait par site, mission, client, période — jamais par personne.
**Argument client** : *« On cherche un dossier de preuve par le contexte du travail (où, quoi, quand, pour qui), jamais par qui l'a fait. Si vous voulez retrouver une intervention spécifique impliquant un collègue, partez de l'intervention. »*
**Lien** : Conversation Claude 2026-05-12.

---

### 2026-05-12 — `assigned_to_user_id` sur mission ou intervention

**Demandeur** : (potentiel, anticipé)
**Demande** : Affecter une mission ou intervention directement à un utilisateur nominatif (au lieu de l'équipe).
**Refus** : Doctrine V2 verrouillée. L'équipe est conteneur logistique ; sa composition peut varier sans impact sur les missions. Affecter à un individu introduit une dépendance personnelle qui glisse vers planning RH. Doctrine V2 § Le principe architectural.
**Argument client** : *« Une équipe est notre unité de couverture. Si Marie est malade, l'équipe assure la continuité. Affecter à Marie créerait un point de défaillance et une logique RH que NetoIAge ne porte pas (utilisez Skello pour ça). »*
**Lien** : Doctrine V2.

---

### 2026-05-12 — Champs temporels `joined_at` / `left_at` sur participations

**Demandeur** : (potentiel, anticipé Phase 10)
**Demande** : Tracer l'heure d'arrivée et de départ de chaque participant sur une intervention.
**Refus** : Time-tracking masqué. Même justifié par un cas réel (Sosefo parti à 10h pour urgence), c'est par là qu'entre la dérive heures travaillées → paie → ERP. Doctrine V3 § Hors-scope structurels.
**Argument client** : *« Le dossier de preuve documente le travail réalisé (photos, checklist, validation), pas la durée individuelle. Si un agent est parti tôt, la preuve reflète ce qui a été fait par l'équipe restante — c'est ça qui compte juridiquement. »*
**Lien** : Doctrine V3 § Hors-scope.

---

### 2026-05-12 — Notifications nominatives à un agent

**Demandeur** : (potentiel, anticipé)
**Demande** : Envoyer une notification push à un agent spécifique (« Pierre, tu as une intervention à valider »).
**Refus** : Communication directe agent introduit une couche RH. Les notifications passent par l'équipe (cohérent avec l'affectation V2).
**Argument client** : *« NetoIAge alerte l'équipe terrain, pas l'individu. C'est cohérent avec notre principe : l'équipe est responsable de la couverture. Si Pierre n'est pas disponible, son chef réassigne dans l'app. »*
**Lien** : Doctrine V2.

---

### 2026-05-12 — Qualifications utilisées pour planning automatique

**Demandeur** : (potentiel, anticipé client ISO 9001)
**Demande** : Auto-planifier les interventions en fonction des qualifications des agents (ex: bionettoyage pédiatrie nécessite CQP APH).
**Refus** : Champ profil simple (« qualifications de Pierre ») OK. Mais utiliser ce champ pour CONTRAINDRE le planning crée une availability-matrix = ERP RH. Doctrine V3 § Chevaux de Troie.
**Argument client** : *« On peut documenter les qualifications dans le profil agent et les afficher au chef d'équipe au moment de l'intervention (« attention, cette mission nécessite CQP APH »). Mais le planning reste organisé à l'équipe, et c'est au chef d'équipe humain de vérifier — pas à l'algorithme. »*
**Lien** : Doctrine V3.

---

### 2026-05-12 — Bouton "Étendre aux futures occurrences" sur /semaine après drag

**Demandeur** : Vincent (interne, première implémentation puis retrait)
**Demande** : Après un drag&drop sur `/semaine`, proposer une action button dans le toast pour propager le changement (date, créneau) à toutes les futures occurrences via mise à jour du template de récurrence.
**Refus** : Viole la doctrine *« /semaine = modifications ponctuelles uniquement »*. Permettre à un drag de modifier une mission complète crée deux modes mentaux confus côté utilisateur, et ouvre la porte à des modifications massives non intentionnelles. La séparation stricte est : `/semaine` = instance ; `/missions` = template.
**Argument client** : *« Sur /semaine on réorganise la semaine en cours, ponctuellement. Pour modifier une récurrence à long terme, on va dans /missions — c'est délibéré, on évite les changements de masse par accident. »*
**Lien** : Conversation Claude 2026-05-12. Code conservé désactivé dans `app/(dashboard)/semaine/actions.ts` (`_extendMoveToTemplateAction_DISABLED`) pour traçabilité.

---

### 2026-05-12 — Index DB sur `intervention_participants.user_id` seul

**Demandeur** : (potentiel, anticipé DBA)
**Demande** : Ajouter un index sur `user_id` pour optimiser les queries « toutes les participations de tel user ».
**Refus** : Marqueur doctrinal anti reverse-lookup. **Note** : ce n'est PAS une mesure de sécurité (un seq scan reste fonctionnel). C'est un signal d'intention dans le schéma + un coût de performance dissuasif pour les usages doctrinalement interdits. La vraie sécurité passe par la RLS + tests doctrine + revue de code.
**Argument client** : (NA — interne)
**Lien** : Doctrine V3 § Garde-fous structurels.

---

## Comment ajouter une entrée

1. Refuser la demande dans le canal d'origine (issue, PR, mail, conversation).
2. Copier le format ci-dessus, remplir tous les champs.
3. Pousser dans la même PR que le refus si applicable (par ex. close issue + commit refusals-log).
4. Citer cette entrée dans toute discussion future où la même demande revient.
