# Provenance des engagements d’un dossier d’appel d’offres

## Objectif

Permettre à MemorIA de démontrer durablement qu’un engagement provient d’une
pièce précise d’un dossier, et éventuellement d’une page précise de cette
pièce.

Cette tranche concerne uniquement la provenance persistée. Elle ne modifie pas
le pipeline d’analyse global et ne construit pas encore le lecteur PDF
multipièces.

## État actuel constaté

Les `tender_documents` possèdent chacun un identifiant, un nom de fichier et un
`tender_id`. Le corpus multipièces sait localiser certaines citations dans une
pièce et une page.

Les lignes `engagements` ne possèdent toutefois aujourd’hui que :

- `tender_id` ;
- `source_excerpt` ;
- `source_ref` JSON, contenant généralement `page` et `section` ;
- `source_type`.

`source_ref.page` seul ne désigne pas une source fiable dans un corpus où
chaque PDF recommence à la page 1. La colonne `tender_analyses.document_sources`
référence un autre modèle (`documents`) et ne constitue pas la provenance d’un
engagement vers `tender_documents`.

## Modèle cible

Ajouter à `engagements` :

```text
tender_document_id uuid nullable references tender_documents(id)
page_number       integer nullable
```

La relation doit être cohérente avec le dossier : le document référencé doit
avoir le même `tender_id` que l’engagement.

La base doit également refuser une page sans document :

```text
page_number is null or tender_document_id is not null
```

La page doit être un entier positif lorsqu’elle est renseignée.

La provenance ne doit pas être une vérité redondante persistée. Son état est
dérivé des deux champs :

| État | Document | Page |
|---|---|---|
| `exact` | connu | connue |
| `document_only` | connu | inconnue |
| `unavailable` | inconnu | inconnue |

L’état « page connue sans document » est interdit.

## Écriture de la provenance

Lorsqu’une citation validée par le serveur est localisée dans le corpus :

1. le nom de la pièce localisée est résolu vers l’identifiant réel du
   `tender_document` du même dossier ;
2. la page est conservée uniquement si le marqueur `[[page N]]` est fiable ;
3. `tender_document_id` et `page_number` sont écrits ensemble pour l’état
   `exact` ;
4. seul `tender_document_id` est écrit pour l’état `document_only` ;
5. si la pièce ou la page ne peut pas être démontrée, les deux champs restent
   nuls.

La résolution ne doit jamais utiliser :

- l’ordre de dépôt ;
- une similarité approximative de nom ;
- une similarité textuelle non validée ;
- une reconstruction postérieure des anciennes lignes.

Les engagements historiques sans provenance restent donc `unavailable`.

## Read model d’audit

Un read model dédié retournera, pour chaque engagement :

- les données de l’engagement ;
- l’identifiant du document source s’il existe ;
- le nom du fichier source s’il existe ;
- le numéro de page s’il est fiable ;
- l’état dérivé `exact`, `document_only` ou `unavailable`.

Le read model ne déduira jamais une relation à partir du texte ou du nom du
fichier. Le composant d’interface consommera uniquement ce contrat.

## Tests obligatoires

Le lot devra démontrer :

1. persistance d’un document et d’une page exacts ;
2. persistance d’un document sans page ;
3. refus d’une page sans document ;
4. refus d’un document appartenant à un autre dossier ;
5. provenance indisponible pour une citation ambiguë ;
6. absence de rétro-imputation sur les engagements existants ;
7. dérivation correcte des trois états ;
8. read model sans rapprochement implicite.

## Hors périmètre

Cette tranche ne comprend pas :

- le déclenchement d’une nouvelle extraction d’engagements ;
- la modification des prompts hors données nécessaires à la provenance ;
- le lecteur PDF multipièces ;
- la navigation automatique dans l’interface ;
- la rétro-imputation des engagements historiques ;
- la gestion des `tender_analyses.document_sources` génériques.

Le lecteur multipièces sera traité dans une tranche suivante, après validation
de cette persistance.
