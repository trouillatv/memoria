# Rapport de qualification — EAU_002

Document : PV de réception des ouvrages d'assainissement du lotissement « Les Terrasses de la Croisille » (rue de l'Autan), remis par l'association syndicale de propriétaires à la Communauté d'agglomération de l'Albigeois (2 pages). Acte juridique de transfert de propriété d'ouvrages EU/EP — pas un CR de chantier : aucune réserve technique de désordre, une seule réserve de nature juridique (maintien des clauses de garantie des entrepreneurs d'origine).

- Référence (Phase A) : 19 éléments texte + 2 photos
- MemorIA (Phase B, pipeline de production réel) : 18 propositions, 18 evidence (toutes `text_excerpt`, 0 image), `proposalEvidenceLinks` vide

## Constat global

10/19 éléments de référence **MATCHED**, 1 **PARTIAL** (E03), 3 **MISSED** (E08, E09, E19), 5 **MISCLASSIFIED** (E10, E11, E14, E16, E18). Recall global au sens strict (matched + 0,5×partial)/total = 10,5/19 ≈ **55 %**.

Précision globale : **16/16 vrais positifs** sur les propositions appariées à un fait réel (0 faux positif). Les 2 propositions non appariées ont été classées LEGITIMATE_EXTRA après vérification directe contre le texte du PDF source, et correspondent à du contenu réel simplement non isolé par la référence Phase A. **Aucune donnée fabriquée détectée** sur ce document — pas d'hallucination de personne, société, date ou montant.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Partial | Missed | Misclassified | Recall | Précision |
|---|---|---|---|---|---|---|---|
| person | 3 | 3 | 0 | 0 | 0 | **100 %** | **100 %** |
| company | 3 | 3 | 0 | 0 | 0 | **100 %** | **100 %** |
| knowledge_fact | 5 | 2 | 1 | 2 | 0 | **50 %** | **100 %** |
| decision | 4 | 2 | 0 | 0 | 2 | **50 %** | **100 %** |
| observation | 2 | 0 | 0 | 0 | 2 | **0 %** | n/a (0 proposition dans cette famille) |
| reservation | 1 | 0 | 0 | 0 | 1 | **0 %** | n/a (0 proposition dans cette famille) |
| action | 1 | 0 | 0 | 1 | 0 | **0 %** | n/a (0 proposition dans cette famille) |
| deadline | 0 | 0 | 0 | 0 | 0 | n/a (0 élément de référence) | n/a (0 proposition dans cette famille) |

Précision = 100 % sur toutes les familles où MemorIA produit effectivement des propositions (person, company, knowledge_fact, decision) : aucun faux positif de contenu. Les recalls les plus bas (`observation` 0 %, `reservation` 0 %, `action` 0 %) ne traduisent pas une perte de contenu mais une dérive de classification, sauf pour `action` où l'unique élément est purement manqué.

## Biais systématiques identifiés

**1. Réserves ratées en tant que famille.** Ce PV de réception ne comporte qu'une seule réserve (E18, de nature juridique : maintien des clauses de garantie/responsabilité des entrepreneurs d'origine malgré la prise en charge de l'entretien par l'agglomération). MemorIA capture le contenu à l'identique mais le classe en `decision`, jamais en `reservation` — la famille `reservation` n'est utilisée à aucun moment sur ce document (0/18 propositions). Sur un document dont l'objet même est de vérifier des réserves de réception, la seule réserve réelle du dossier échappe à sa famille métier.

**2. Décision centrale de conformité mal classée.** E14 (« l'association syndicale et la communauté d'agglomération reconnaissent la conformité et le bon entretien des ouvrages »), qui est le constat contradictoire le plus important du PV, est extraite mot pour mot mais classée `knowledge_fact` au lieu de `decision`. Le même écart touche E16 (constat de remise conditionné à la délibération). En revanche E15 et E17 (acceptation de la remise, transfert de garde/responsabilité), extraites du même paragraphe, sont correctement classées `decision` : l'incohérence de classification est locale à des phrases quasi voisines du même paragraphe, pas un biais systématique sur tout le document.

**3. Observations techniques classées knowledge_fact.** Les deux descriptions quantifiées des réseaux (E10 eaux usées, E11 eaux pluviales : linéaires, diamètres, nombre de regards/branchements) sont classées `knowledge_fact` au lieu d'`observation`, avec un contenu numérique intégralement fidèle (aucune valeur altérée).

**4. Famille action totalement absente du run** (0 proposition sur 18) : la seule action de référence (E09, invitation de l'association syndicale à la communauté d'agglomération de participer à la réception) est purement manquée, pas fragmentée ni requalifiée.

**5. Mentions administratives formelles manquées.** Les 2 éléments manqués restants concernent des mentions administratives : le principe juridique général des biens de retour (E08) et le cadre timbré de contrôle de légalité rattachant le PV à la délibération DEL2019_167 (E19) — cohérent avec le biais déjà observé sur LRM_01 (clause administrative de fin de CR manquée) : les mentions de procédure/validation sont un angle mort récurrent.

**6. Biais inverse de la sur-fragmentation habituelle.** Sur E03, c'est la référence qui regroupe 2 faits (permis d'aménager 1999 + constitution de l'association syndicale) en un seul élément, et MemorIA n'en capture qu'un (le permis) comme `knowledge_fact` distinct — la constitution de l'association n'est nulle part tracée comme événement daté, même si l'entité qui en résulte (association syndicale de propriétaires) est bien extraite par ailleurs.

## Propositions non appariées (legitimate extra)

2 propositions `knowledge_fact` non appariées à un élément de référence, toutes deux vérifiées contre le texte du PDF source :
- « Lotissement : rue de l'Autan Les Terrasses de la Croisille » — en-tête du document (adresse/désignation), repris en creux dans E01/E03 mais non isolé comme élément propre par la référence Phase A.
- « À l'intérieur de cette opération d'aménagement une voirie interne dénommée rue de l'Autan, un réseau d'eaux usées et un réseau d'eaux pluviales ont été créés. » — phrase réelle du préambule (page 1, juste après la phrase captée par E03), simplement non isolée par la référence Phase A.

## Photos

Référence : 2 photos (P01 logo décoratif, P02 cadre timbré préfecture, rôle `document_context`) contre **0 evidence image** côté MemorIA (18 evidence, toutes `text_excerpt`, `proposalEvidenceLinks` vide). Cohérent avec le MISSED de E19 : le cadre timbré n'est capté ni comme texte ni comme image côté MemorIA.

## Éléments manqués

- **E08** (knowledge_fact) — « Ces ouvrages n'ont pas vocation à rester durablement du domaine privé... Ils constituent des biens de retour possible aux collectivités intéressées. » Principe juridique général motivant l'acte, aucune proposition MemorIA ne le couvre.
- **E09** (action) — « L'association syndicale des propriétaires invite la communauté d'agglomération... à participer à la réception des ouvrages. » Aucune proposition ; la famille `action` n'est utilisée nulle part ailleurs dans ce run (0/18).
- **E19** (knowledge_fact) — Cadre timbré de contrôle de légalité (envoyé/reçu/affiché en préfecture le 14/10/2019, ID 081-248100737-20191009-DEL2019_167-DE), aucune proposition ni evidence ne couvre ce passage, alors qu'il rattache le PV à sa délibération d'origine (DEL2019_167).

## Synthèse

EAU_002 est une famille documentaire nouvelle par rapport aux CR de chantier/visite habituels du corpus : PV de réception/rétrocession d'ouvrages, sans aucune réserve technique de désordre — cohérent avec l'absence de proposition `observation` anormale et la nature purement juridique de la réserve E18. Le recall brut (55 %) est nettement tiré vers le bas par la classification, pas par la perte de contenu : sur les 9 éléments non MATCHED, 5 sont MISCLASSIFIED (contenu identique, mauvaise famille) et seuls 3 sont réellement absents (2 mentions administratives formelles + 1 action). La précision reste parfaite (16/16, 0 faux positif, 2 legitimate extra vérifiées). Le point le plus actionnable est la frontière `decision`/`knowledge_fact` et l'absence totale de la famille `reservation` sur un document dont l'objet même est une réception d'ouvrages avec réserve.
