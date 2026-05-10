import type { KnowledgeCategory } from '@/types/db'

export interface CategoryTemplate {
  /** Markdown pré-rempli dans le textarea. Reste éditable librement. */
  content: string
  /** Tags suggérés cliquables au-dessus de l'input tags. */
  suggestedTags: string[]
  /** Court hint affiché sous le label « Contenu » dans le drawer. */
  hint: string
}

export const CATEGORY_TEMPLATES: Record<KnowledgeCategory, CategoryTemplate> = {
  references_clients: {
    hint: 'Décris une référence client : secteur, surface, durée, témoignage.',
    suggestedTags: ['hospitalier', 'tertiaire', 'scolaire', 'industriel', 'iso9001', 'ecolabel', 'gros_volume'],
    content: `## Client

[Nom du client / collectivité]

## Secteur d'activité

[Hospitalier / Tertiaire / Scolaire / Industriel / Public]

## Volume du contrat

- Surface : [m²]
- Volume horaire : [h/mois]
- Durée du marché : [date début — date fin ou "aujourd'hui"]

## Spécificités

[Particularités du site / contraintes / périmètre]

## Témoignage

[Citation client si disponible]
`,
  },
  moyens_humains: {
    hint: 'Décris un effectif type : rôle, nombre, qualifications, certifications.',
    suggestedTags: ['cqp_aph', 'atqs', 'iso9001', 'cdi', 'chef_equipe', 'agent_propreté'],
    content: `## Rôle

[Agent de propreté / Chef d'équipe / Responsable qualité / etc.]

## Effectif

[Nombre d'agents]

## Qualifications

- [CQP APH, ATQS, etc.]
- [Formations spécifiques]

## Certifications & habilitations

- [ISO 9001 sensibilisation]
- [Habilitations sectorielles : milieu hospitalier, agro-alimentaire, etc.]

## Notes

[Particularités, ancienneté moyenne, polyvalence]
`,
  },
  materiel: {
    hint: 'Décris un type de matériel : marque, certifications, usage typique.',
    suggestedTags: ['ecolabel', 'monobrosse', 'autolaveuse', 'aspirateur', 'desinfectant', 'consommable'],
    content: `## Catégorie de matériel

[Monobrosse / Autolaveuse / Aspirateur / Produit / etc.]

## Marque & modèle

[Numatic NUC244 / Karcher BD 30/4 C / etc.]

## Quantité disponible

[Nombre d'unités]

## Certifications

- [Ecolabel, NF Environnement, ISO 14001 du fournisseur, etc.]

## Usage typique

[Pour quel type de site / surface / fréquence]
`,
  },
  procedures: {
    hint: 'Décris une procédure métier : étapes, fréquence, contrôles qualité.',
    suggestedTags: ['desinfection', 'bloc_op', 'urgence', 'quotidien', 'iso9001', 'haccp'],
    content: `## Intitulé

[Procédure désinfection bloc opératoire / etc.]

## Fréquence

[Quotidienne / Hebdomadaire / Sur déclenchement]

## Étapes-clés

1. [Étape 1]
2. [Étape 2]
3. [Étape 3]

## Produits & matériel utilisés

- [Détail des consommables et équipement]

## Contrôles qualité

- [Auto-contrôle agent]
- [Contrôle chef d'équipe]
- [Validation client]

## Référence normative

[Norme NF / protocole interne / référence ISO]
`,
  },
  qualite: {
    hint: 'Décris une certification, charte ou engagement qualité.',
    suggestedTags: ['iso9001', 'iso14001', 'qualipropre', 'ecolabel', 'rgpd', 'attestation'],
    content: `## Certification / engagement

[ISO 9001:2015 / ISO 14001 / Qualipropre / Charte zéro phyto / etc.]

## Date d'obtention & validité

- Obtenue le : [JJ/MM/AAAA]
- Valide jusqu'au : [JJ/MM/AAAA]

## Périmètre couvert

[Quelles activités sont certifiées]

## Organisme certificateur

[AFNOR / Bureau Veritas / etc.]

## Documents joints

[Liste des certificats / attestations à uploader en pièce jointe]
`,
  },
  anciens_memoires: {
    hint: 'Référence un ancien mémoire technique : client, résultat, leçons.',
    suggestedTags: ['gagne', 'perdu', 'hospitalier', 'tertiaire', '2024', 'reconduit'],
    content: `## AO d'origine

- Client : [Nom du donneur d'ordre]
- Date de réponse : [Mois AAAA]
- Volume : [m² / heures / €]

## Résultat

[Gagné / Perdu / En cours]

## Points forts de notre réponse

- [Argument 1]
- [Argument 2]

## Leçons apprises

[Ce qu'on aurait pu mieux faire / ce qui a fait la différence]

## Extrait de la mémoire technique

[Coller ici 200-500 mots de la mémoire technique originale, ou un lien]
`,
  },
}
