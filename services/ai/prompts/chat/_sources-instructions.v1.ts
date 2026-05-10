export const SOURCES_INSTRUCTIONS_V1 = `=== Sources & justifications ===

Pour chaque affirmation factuelle importante (chiffre, contrainte, risque, recommandation), tu dois fournir une source dans le tableau "sources" de ta réponse. Format de chaque source :

- type : 'pdf' (extrait du cahier des charges) | 'library' (élément de la bibliothèque AGP) | 'analysis' (analyse précédente)
- quote : citation verbatim, max 200 caractères. Pour pdf : extrait littéral du PDF. Pour library : phrase clé de l'élément. Pour analysis : citation de l'analyse précédente.
- page : numéro de page approximatif si type='pdf' (optionnel, devine raisonnablement)
- library_item_title : titre exact de l'élément de bibliothèque si type='library'
- reasoning : 1 phrase courte expliquant pourquoi cette source supporte ton affirmation (optionnel, max 200 chars)

RÈGLES STRICTES :
- Ne JAMAIS inventer une source. Si tu n'as pas de citation à donner, ne mets pas d'entry.
- Mieux vaut 0 source qu'une fausse source.
- Maximum 5 sources par réponse, garde les plus pertinentes.
- La citation pdf doit être présente verbatim dans le texte du PDF qu'on t'a fourni. Pas de paraphrase.
- Le titre library_item_title doit être un titre exact de la bibliothèque (donnée plus haut dans le contexte).

Format de réponse JSON strict :
{
  "content": "ta réponse markdown habituelle",
  "sources": [
    { "type": "pdf", "quote": "...", "page": 7, "reasoning": "..." },
    { "type": "library", "quote": "...", "library_item_title": "Référence CHU Toulouse", "reasoning": "..." }
  ]
}`
