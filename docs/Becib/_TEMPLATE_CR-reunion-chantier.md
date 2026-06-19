---
company: BECIB
template_type: cr_reunion_chantier
name: "Compte-rendu de réunion de chantier"
is_default: true
source: "Dérivé des PV LA CRAVACHE GDE (CR001→CR004) Becib."
style: "_STYLE_Becib.md"
---

# Template Becib — Compte-rendu de réunion de chantier

> Ce fichier décrit le format de PV que Becib produit aujourd'hui. La génération IA
> doit **remplir cette structure** à partir d'une réunion analysée — jamais inventer
> une autre mise en page. Si une compagnie n'a pas de template, on ne génère pas de
> document formaté (cf. doctrine : on garde la vue structurée in-app).

## prompt_system

Tu rédiges un compte-rendu de réunion de chantier **au format Becib** (maîtrise d'œuvre).
Applique d'abord le guide _STYLE_Becib.md (terminologie, tournures, codes acteurs, clause 48h).
Règles de style et de fond :
- Ton factuel, neutre, à l'infinitif ou au constat. Pas d'interprétation, pas de jugement.
- Chaque point examiné porte, à droite, le **responsable de l'action** (colonne ACTION) :
  codes acteurs `MOA` (maîtrise d'ouvrage), `MOE`/`BECIB` (maîtrise d'œuvre),
  l'entreprise titulaire (ex. `ETV`), partenaires/exploitant (ex. `CLUB`). Plusieurs
  acteurs possibles (`ETV/MOA`).
- Marquer l'état de chaque point : `= fait`, `= OK`, `= en cours`, `= à faire`,
  `= ATTENTE DECISION`, etc.
- Conserver la numérotation des sections et l'ordre ci-dessous.
- Regrouper les points techniques par **corps d'état / domaine** (Travaux préliminaires,
  Terrassements, Assainissement, Divers… selon le chantier).
- Inclure systématiquement la clause des 48h dans « Remarques sur CR précédent ».
- Ne jamais inventer de présence : un intervenant non mentionné reste sans code.

## template_content

```
{{maitre_ouvrage}} / BECIB / {{nom_chantier}} / CR réunion de chantier
Numéro DNS : {{numero_dns}}   Version : {{version}}   Modif. : {{modif_ordre}}   Date : {{date_reunion}}

{{titre_projet}}

COMPTE-RENDU N°{{numero_cr}} DE LA REUNION DE CHANTIER
Du {{date_reunion_longue}} - semaine {{numero_semaine}}

1  INTERVENANTS
(I : Invité - P : Présent – AE : Absent excusé – AN : Absent non excusé – D : diffusion)

MAITRISE D'OUVRAGE
{{#intervenants_moa}} {{organisme}} | {{representant}} | {{tel}} | {{mob}} | {{email}} | {{presence}} {{/intervenants_moa}}
MAITRISE D'ŒUVRE
{{#intervenants_moe}} {{organisme}} | {{representant}} | {{tel}} | {{mob}} | {{email}} | {{presence}} {{/intervenants_moe}}
ENTREPRISE TITULAIRE
{{#intervenants_entreprise}} {{organisme}} | {{representant}} | {{tel}} | {{mob}} | {{email}} | {{presence}} {{/intervenants_entreprise}}
PARTENAIRES
{{#intervenants_partenaires}} {{organisme}} | {{representant}} | {{tel}} | {{mob}} | {{email}} | {{presence}} {{/intervenants_partenaires}}

2  ORDRE DU JOUR
{{#ordre_du_jour}} - {{point}} {{/ordre_du_jour}}

3  REMARQUES SUR CR PRECEDENT
{{remarques_cr_precedent}}
NOTA : En l'absence d'observations sous 48h, le présent CR est considéré comme accepté sans réserve.

4  POINTS EXAMINES

POINTS ADMINISTRATIFS                                                          ACTION
{{#points_administratifs}} - {{libelle}} = {{etat}}                            {{responsable}} {{/points_administratifs}}

POINTS TECHNIQUES                                                              ACTION
{{#sections_techniques}}
{{intitule_section}}
{{#points}} - {{libelle}} = {{etat}}                                          {{responsable}} {{/points}}
{{/sections_techniques}}

DIVERS                                                                         ACTION
{{#points_divers}} - {{libelle}} = {{etat}}                                    {{responsable}} {{/points_divers}}

PROCHAINE REUNION : {{date_prochaine_reunion}}

Rédacteur : {{redacteur}} — {{organisme_redacteur}}
```

## Notes de mapping (réunion analysée → template)

- `participants` (site_reports.participants) → blocs INTERVENANTS, à ventiler par rôle.
- `proposals` de type `action` / actions ouvertes → points avec colonne ACTION + responsable.
- `risks` (dependency/risk/vigilance) → points « ATTENTE DECISION » / « Attention… ».
- décisions/constats → points examinés avec leur état.
- `transcript_corrected` = source de vérité pour le détail des points.
