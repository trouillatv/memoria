# Rapport de qualification — MEL_CR03

Document : compte-rendu de réunion de chantier N°3 (réf. 4160884, daté du 20/12/2017, rédigé par Sébastien Thierry d'ARTELIA), chantier VRD assainissement/AEP à Melay (Communauté de Communes des Savoirs Faire + Commune de Melay), entreprise unique STPI sur les lots 1 et 2. Document purement textuel et tabulaire : présence, avancement chiffré par adresse rue des Pothières, options techniques en cours d'arbitrage (sauterelles, forage dirigé, encorbellement), aucune réserve (chantier pas encore en réception).

- Référence (Phase A) : 75 éléments texte, 0 photo (aucune illustration de chantier, chaque page restituée comme mise en page)
- MemorIA (Phase B, pipeline de production réel) : 80 propositions + 80 evidence texte, 0 evidence image, 10 entrées `proposalEvidenceLinks`

## Résultats par famille

| Famille | Éléments réf. | Recall | Propositions MemorIA | Précision |
|---|---|---|---|---|
| person | 14 | **100 %** (14/14 MATCHED) | 14 | **100 %** |
| company | 8 | **100 %** (8/8 MATCHED) | 9 (1 legitimate_extra) | **100 %** |
| deadline | 2 | **100 %** (2/2 MATCHED) | 3 | **100 %** |
| decision | 5 | **100 %** (5/5 MATCHED) | 6 | **100 %** |
| action | 8 | **62,5 %** (5 MATCHED, 3 MISCLASSIFIED) | 5 | **100 %** |
| observation | 21 | **4,8 %** strict (1 MATCHED), 20 MISCLASSIFIED | 5 | **100 %** |
| knowledge_fact | 17 | **52,9 %** (9 MATCHED, 7 MISSED, 1 MISCLASSIFIED) | 38 | **100 %** |
| reservation | 0 | -- | 0 | -- |

**Global** : recall = **44/75 MATCHED (58,7 %)**, 0 PARTIAL, 7 MISSED, 24 MISCLASSIFIED. En comptant le contenu réellement détecté (MATCHED + MISCLASSIFIED) : **68/75 (90,7 %)**. Précision = **79/79 vrais positifs (100 %)**, 0 faux positif, 1 legitimate_extra exclue du calcul.

Contrairement à LRM_01 (biais de sur-fragmentation pure, précision 98 %), le point faible de MEL_CR03 n'est pas la fabrication de contenu mais la **cohérence de classification métier** : près d'1 fait sur 3 correctement détecté change de famille au passage dans le pipeline.

## Faux positifs

**Aucun.** 0 FALSE_POSITIVE sur les 80 propositions. Aucune personne, société, date, montant ou fait inventé détecté.

## Éléments manqués

**7, tous des rubriques administratives/RAS génériques**, même profil que le seul MISSED de LRM_01 :
- E24 — clause de validation tacite du CR à 8 jours.
- E25 — règle de diffusion des CR par courriel uniquement.
- E26 — diffusion aux sous-traitants à la charge des entreprises.
- E27 — RAS sur observations du CR précédent.
- E34, E35 — RAS intempéries LOT1 et LOT2.
- E69 — récapitulatif « Avancement des travaux LOT2 : RAS » (section 7, p.5), qui recoupe le fait déjà capté sous E58 (0% d'avancement, p.4, sous kf-avancement-lot2-p4) sans proposition distincte pour ce second passage.

Impact mineur (clauses types ou RAS sans contenu substantiel propre au chantier), mais confirme un angle mort récurrent du pipeline sur les mentions administratives de validation/diffusion de CR.

## Legitimate extra

**1 seule.** `company-agence-eau-p1` — « Agence de l'Eau », listée dans le tableau des destinataires page 1 (« Autres intervenants »), confirmée par relecture directe du PDF source juste après la ligne DDT police de l'Eau 52. La référence Phase A ne l'a pas isolée (aucun nom de contact associé). MemorIA la qualifie elle-même `companyRole="diffusion uniquement"` et `relevanceScore="weak"`, signe que le pipeline ne la surclasse pas en intervenant substantiel.

## Biais récurrents

1. **Reclassification systématique observation → knowledge_fact (biais dominant, nouveau par rapport à LRM_01).** 20 des 21 éléments observation de la référence — constats chiffrés d'avancement par adresse rue des Pothières (E63-E68), personnel sur site (E36, E37), visite SPS (E38), options techniques nuancées « à l'étude »/« n'est pas écartée » (E53, E54), avancement LOT2 (E58) — sont captés par MemorIA en knowledge_fact plutôt qu'observation. Le contenu factuel reste fidèle dans tous les cas ; c'est uniquement la famille métier qui change.
2. **Contradiction directe avec un raisonnement explicite de la référence (E52).** La référence documente noir sur blanc dans sa classificationNote que « les Elus ont pris note » n'est pas une décision ferme, contrairement à E48 (« Elus ont validé »). MemorIA extrait pourtant ce fragment précis comme `decision` (`dec-forage-dirige-p4`), en contradiction avec cette clarification. C'est le cas de confusion de famille le plus net du document : le moteur ne fait pas que diverger sur une zone grise, il tranche dans le sens opposé à un arbitrage humain explicite et documenté.
3. **Reclassification action → observation/knowledge_fact, plus limitée.** 3 éléments action (E43 « permissions de voirie à afficher », E46 « documents restant à fournir », E72 « planning LOT2 à fournir ») perdent leur statut d'obligation « à faire » au profit d'un simple constat, sans perte de texte.
4. **Sur-fragmentation avec dérive de famille partielle sur le fragment secondaire.** Sur 4 éléments (E45, E56, E59, E61), le fragment principal garde la bonne famille (action ou decision) mais un second fragment du même paragraphe (mur à abattre, regard à abandonner, arrêté de circulation, raccordement AEP) est reclassé en knowledge_fact. Sur 4 autres (E40, E51, E60, E62), c'est la totalité des fragments qui dérive vers knowledge_fact. Contenu toujours intégralement couvert, jamais perdu.
5. **Reclassification en sens inverse, isolée : knowledge_fact → deadline (E73).** Une procédure récurrente de délai de visa (« au moins 3 semaines avant intervention ») sans date calendaire concrète est versée en famille `deadline` sans `dueDate` — même mécanisme de confusion procédure/échéance que documenté sur LRM_01-E13, mais sans fabrication de date ici (aucun jour précis inventé, contrairement à LRM_01).
6. **Sur-affirmation ponctuelle sur une ambiguïté source documentée (E02, E03).** MemorIA affirme un statut de présence (« absent »/« présent ») pour Mme Mazelin et Mme Thabourin, là où la référence s'est volontairement abstenue faute d'alignement net des colonnes de la feuille de présence p.2 — ambiguïté vérifiée par relecture directe du PDF. Identité et fonction restent correctes ; c'est un point de vigilance sur la fiabilité de l'extraction de feuilles de présence mal alignées, pas une fabrication de personne.

## Photos

Référence : 0 photo (`photos: []`), document purement textuel et tabulaire, aucune illustration de chantier (readerNotes). MemorIA : 0 evidence de type image, 80 evidence toutes `text_excerpt`, 10 entrées `proposalEvidenceLinks`. Cohérence totale entre les deux sources sur cette dimension.
