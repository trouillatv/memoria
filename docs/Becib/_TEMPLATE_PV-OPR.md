---
company: BECIB
template_type: pv_opr
name: "Procès-verbal des opérations préalables à la réception (OPR)"
is_default: false
source: "Dérivé de CRAVACHE GDE - PV OPR.pdf + ANNEXE PV OPR.pdf."
style: "_STYLE_Becib.md"
---

# Template Becib — PV des opérations préalables à la réception (OPR)

> Document **administratif/juridique** de réception de travaux. Structure à cases à
> cocher, formules consacrées (cf. _STYLE_Becib.md, section « Langage juridique »).
> La génération IA remplit les champs et coche les constats à partir d'une visite de
> réception analysée ; elle ne reformule jamais les formules légales.

## prompt_system

Tu rédiges un **Procès-Verbal des Opérations Préalables à la Réception** au format Becib (MOE).
Respecte impérativement le guide _STYLE_Becib.md (langage juridique + réserves).
- Reprends les formules consacrées mot pour mot.
- Coche (`X`) uniquement les constats étayés par la visite ; laisse vide sinon.
- Les réserves sont factuelles, chacune avec son responsable en fin de ligne.
- Sépare « Réserves » et « Réserve liée au parfait achèvement ».
- N'invente aucune date, aucun nom, aucun constat non fourni.

## template_content

```
{{maitre_ouvrage}} / BECIB / {{nom_chantier}} / PV OPR
Numéro DNS : {{numero_dns}}   Date : {{date_opr}}

{{titre_projet}}
PROCES-VERBAL DES OPERATIONS PREALABLES A LA RECEPTION
DU {{date_opr_longue}}

[{{reception_complete}}] Réception des ouvrages
[{{reception_partielle}}] Réception partielle      BDC n° {{numero_bdc}}   Notifié le : {{date_notif}}
Objet : {{objet}}
Titulaire : {{titulaire}}

Je soussigné, Maître d'Œuvre, {{moe_nom}} :
[{{moa_present}}] En présence de M. {{moa_representant}}, représentant le maître d'ouvrage
[{{entrepreneur_present}}] En présence de l'entrepreneur dûment convoqué représenté par {{entrepreneur_representant}}

Après avoir procédé aux examens et vérifications nécessaires, constate que :

1 - LES EPREUVES PREVUES AU MARCHE
   [{{epreuves_exception}}] ont été effectuées à l'exception de celles indiquées en annexe 2
   [{{epreuves_concluantes}}] sont concluantes

2 - LES TRAVAUX ET PRESTATIONS PREVUS AU MARCHE
   [{{travaux_executes}}] ont été exécutés
   [{{travaux_exception}}] ont été exécutés à l'exception de ceux indiqués en annexe 1

3 - LES OUVRAGES
   [{{ouvrages_conformes}}] sont conformes aux spécifications du marché
   [{{ouvrages_exception}}] sont conformes ... à l'exception des imperfections ou malfaçons indiquées en annexe 3

4 - LES INSTALLATIONS DE CHANTIER
   [{{install_repliees}}] ont été repliées        [{{install_non_repliees}}] n'ont pas été repliées

5 - LES TERRAINS ET LES LIEUX
   [{{lieux_remis}}] ont été remis en état        [{{lieux_non_remis}}] n'ont pas été remis en état

Dressé le {{date_dresse}}        Accepté le {{date_accepte}}
Le Maître d'Œuvre              Le titulaire

--- ANNEXE 1 — RESERVES ---
Réserves
{{#reserves}} - {{libelle}}   {{responsable}} {{/reserves}}

Réserve liée au parfait achèvement
{{#reserves_parfait_achevement}} - {{libelle}}   {{responsable}} {{/reserves_parfait_achevement}}

{{#photos_jointes}}PHOTOS du site ci-joint.{{/photos_jointes}}
```
