# 10 — PL0 : audit du planning récurrent (avant toute ligne de code)

> Audit 2026-07-13, demandé explicitement avant implémentation (« Aucun code
> avant cet audit »). Tout est prouvé fichier:ligne. **Conclusion : le lot PL
> ne peut pas démarrer tel quel — un de ses trois piliers est une ligne rouge
> produit, armée par un test qui fait échouer le build.**

## Le besoin (photo du planning Servinor + entretien Guillaume)

Une matrice **agents × jours du mois** pour un site (Discount Poindimié) :
trois agentes en lignes, Travail / Repos par jour, cycles de 1 à 4 semaines
répétés sur des mois, corrigés par des exceptions (jour férié, fermeture du
magasin, absence ou suspension d'une agente, remplacement).

## Ce que le dépôt sait déjà faire

| Brique | Où | Verdict |
|---|---|---|
| Rythmes récurrents | `intervention_templates` (mig 021:25-52) | 5 fréquences plates : `daily/weekdays/weekly/monthly/one_shot` |
| Date de fin | `ends_on` (021:35), respectée en génération | ✅ existe déjà |
| Heure précise | `planned_start_hhmm`/`planned_end_hhmm` (mig 085) | ✅ au niveau template |
| Génération | `generateInterventionsFromTemplates` (`lib/db/intervention-templates.ts:293`) | **Paresseuse, à la lecture de page** ; **cap dur de 7 jours** (ligne 222) ; **aucun cron** |
| Exception | `markInterventionSkipped` (ligne 624) + `skipped_at/reason/by` | **Une occurrence à la fois**, APRÈS matérialisation, raison obligatoire |
| Grille + drag & drop | `app/(dashboard)/semaine/WeekGrid*.tsx` | Réutilisable tel quel pour une vue mois |
| Dates / heures | `lib/time/local-date.ts`, `lib/time/prestation-slot.ts` | Pièges Nouméa déjà réglés, verrouillés par tests |
| Idempotence | index UNIQUE partiel (021:120) + pré-filtrage SELECT | Recette éprouvée, réplicable |
| Signaux | `week-operational-signals.ts`, `week-vigilance.ts` | Un « site fermé, prestation prévue » s'y insère en ~1 jour — **une fois la donnée source créée** |
| Équipes bi-temporelles | `team_members.joined_at/left_at` (023:52-59) | Sait déjà dire « qui était dans l'équipe le 12 mars » |

## Ce qui manque — trois concepts, pas un

### 1. La personne comme ligne de planning → **REFUS ARMÉ, pas un manque**

Il n'existe **aucune ligne `(personne, date, état)`** en base, et ce n'est pas
un oubli :

- `assigned_to_user_id` sur mission/intervention = **interdit absolu**
  (mig 023:16-19), et `tests/doctrine/forbidden-symbols.test.ts:67-70` **fait
  échouer le build** si le symbole apparaît.
- `(user|agent)Availability` → **build FAIL** (même test, lignes 60-63) :
  « modèle de disponibilité user = porte d'entrée du time-tracking ».
- `docs/superpowers/doctrines/planning-doctrine.md:404` : « *Je veux planifier
  qui fait quoi la semaine prochaine* » → « **🚨 Ligne rouge produit.
  Person-level scheduling = ERP RH. Refus.** » — c'est **littéralement** la
  demande Servinor.
- Le vocabulaire lui-même est banni de l'UI (`.github/PULL_REQUEST_TEMPLATE.md:27`) :
  *présent / absent / disponible / retard / pointage…* — or la spec s'exprime en
  « présences », « absence », « remplacement », « suspension ».

**Ce n'est pas une contrainte technique. C'est un arbitrage produit** — le même
qui a fait refuser l'ERP RH, le pointage et le GPS. Il ne peut être levé que
par Vincent, explicitement.

### 2. Le cycle pluri-hebdomadaire → **manque additif, aucune opposition**

`frequency` est plat et `day_of_week` est un **scalaire** (021:32) : « lundi +
jeudi » demande déjà deux templates, et une **alternance A/B est impossible**
(aucun `cycle_length`, `anchor_date`, `week_index`). Rien dans la doctrine ne
l'interdit : c'est constructible dès demain.

### 3. L'exception datée → **manque additif, avec une réserve**

**Zéro table** sur 194 migrations : pas de `site_closures`, pas de jours fériés,
pas d'absences. Aujourd'hui, un 14 juillet = N clics manuels de `skip`. La
fermeture d'un **site** est doctrinalement saine (sujet = LIEU). L'« absence
d'un agent » est, elle, de la donnée RH → même ligne rouge que le point 1.

> Réserve honnête : `lib/db/intervention-templates.ts:14-15` grave « ni jours
> fériés » comme signal ROUGE STOP. À relire avec Vincent : le refus visait
> probablement le planning d'agents, pas le calendrier d'un lieu.

## La voie qui existe déjà — « une équipe d'une personne »

`audit/00-enseignements-guillaume.md:52` l'a déjà constatée et validée : le
conteneur « équipe » colle mal au nettoyage (1 personne = 1 équipe), **et le
modèle actuel le permet déjà**.

Conséquence directe :

- une matrice **« équipes-mono × jours »** est **doctrinalement légale** ;
- une matrice **« agents × jours »** casse le build.

Les deux affichent la même chose à l'écran de Guillaume. La première livre
l'essentiel de la valeur **sans ouvrir le chantier autorisation** (rôle
« Agent » manquant, friction #6) ni faire sauter la CI.

C'est la seule voie que je recommande d'explorer avant de rouvrir la doctrine.

## Le piège structurel de la vue mois

La génération est plafonnée à **7 jours** : une vue mois qui lirait
`interventions` serait **vide à 75 %**. Il faut donc soit lever le cap (arbitrage
architectural déjà ouvert dans `01-model.md:97-102` : « soit l'étendre, soit le
remplacer, jamais les deux en parallèle »), soit **projeter les rythmes
virtuellement** sur le mois (`matchesFrequency` est privée, ligne 243 — à
exporter).

## Décision attendue de Vincent (rien ne bouge avant)

1. **Le planning de présences par personne est-il ré-ouvert ?** C'est un
   changement de vision produit (refus ERP RH), pas une évolution technique.
   - Si **non** → on construit « équipes-mono × jours » : même écran, doctrine
     intacte, aucun test à désarmer.
   - Si **oui** → il faut d'abord réécrire la doctrine ET les tests qui la
     protègent, en connaissance de cause (c'est ce qu'ils sont là pour forcer).
2. **Les cycles (PL4) et les fermetures de site (PL8-PL9) peuvent-ils démarrer
   tout de suite ?** Ils sont additifs et sans opposition doctrinale — ce sont
   les deux tiers de la valeur, disponibles sans arbitrage.
3. **Matérialisation** : lever le cap de 7 jours, ou projeter à la volée ?

## Ordre recommandé (si feu vert)

1. **PL8a — fermetures de site** (table + saisie sur la fiche chantier) : sujet
   = lieu, zéro conflit doctrinal.
2. **PL9 — l'alerte** « site fermé, prestation prévue » + les 5 gestes
   (déplacer avant/après/autre date/maintenir/annuler). C'est **le** besoin de
   Guillaume : « il faut que je décale mes filles ». Le moteur de signaux est prêt.
3. **PL4 — cycles 1 à 4 semaines** (`cycle_length_weeks` + `anchor_date`).
4. **PL7 — vue mois** de contrôle (lignes = équipes-mono), après la décision (1).
5. Le reste (absences, remplacements assistés) **dépend de l'arbitrage produit**.

**Aucune ligne de code n'a été écrite pour ce lot.**
