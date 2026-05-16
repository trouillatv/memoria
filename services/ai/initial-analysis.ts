import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { ChatAgentName } from '@/types/db'

import { GENERAL_INIT_V1 } from './prompts/initial-analysis/general.v1'
import { LECTEUR_AO_INIT_V1 } from './prompts/initial-analysis/lecteur-ao.v1'
import { MEMOIRE_TECHNIQUE_INIT_V1 } from './prompts/initial-analysis/memoire-technique.v1'
import { CONTRADICTEUR_INIT_V1 } from './prompts/initial-analysis/contradicteur.v1'
import { FINANCIER_INIT_V1 } from './prompts/initial-analysis/financier.v1'
import { TERRAIN_INIT_V1 } from './prompts/initial-analysis/terrain.v1'
import { CONFORMITE_INIT_V1 } from './prompts/initial-analysis/conformite.v1'

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const keyPointsSchema = z.record(z.string(), z.unknown())

const analysisOutputSchema = z.object({
  summary: z.string(),
  key_points: keyPointsSchema.optional().default({}),
  raw_content: z.string().optional().default(''),
})

export type AnalysisKeyPoints = z.infer<typeof keyPointsSchema>

export interface InitialAnalysisResult {
  summary: string
  keyPoints: AnalysisKeyPoints
  rawContent: string
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Prompt map
// ---------------------------------------------------------------------------

const PROMPT_MAP: Record<ChatAgentName, { version: string; modelTier: 'light' | 'heavy'; system: string }> = {
  general: GENERAL_INIT_V1,
  lecteur_ao: LECTEUR_AO_INIT_V1,
  memoire_technique: MEMOIRE_TECHNIQUE_INIT_V1,
  contradicteur: CONTRADICTEUR_INIT_V1,
  financier: FINANCIER_INIT_V1,
  terrain: TERRAIN_INIT_V1,
  conformite: CONFORMITE_INIT_V1,
}

// ---------------------------------------------------------------------------
// Mock fixtures — one distinct fixture per agent
// ---------------------------------------------------------------------------

const MOCK_FIXTURES: Record<ChatAgentName, z.infer<typeof analysisOutputSchema>> = {
  general: {
    summary:
      '[Mock] Marché de services de nettoyage tertiaire multi-sites, durée 3 ans renouvelable une fois. Volume estimé 200 000 m² annuels, enjeu stratégique fort pour notre développement régional. Compétition attendue de 4-6 prestataires. Délai de réponse serré (21 jours). Profil de marché accessible pour une PME bien organisée.',
    key_points: {
      strengths: ['Périmètre géographique correspondant à notre zone de chalandise', 'Durée ferme 3 ans garantissant la visibilité'],
      risks: ['Délai de réponse très court (21 jours)', 'Critère prix fortement pondéré (60%)'],
      blockers: [],
      opportunities: ['Reconduction automatique possible sans remise en concurrence', 'Volumes modulables à la hausse selon satisfaction'],
    },
    raw_content:
      '# Analyse générale\n\n## Contexte du marché\n[Mock] Ce marché porte sur la prestation de nettoyage tertiaire pour un donneur d\'ordre public.\n\n## Enjeux stratégiques\n[Mock] Opportunité de croissance significative pour notre portefeuille régional.',
  },
  lecteur_ao: {
    summary:
      '[Mock] Document bien structuré mais dense : 47 pages avec CCTP détaillé. Trois zones d\'ambiguïté identifiées sur les fréquences week-end. Clause pénale à 0,5%/jour de retard sur reprise. Exigence de réponse sur devis unitaires en annexe 6 (risque si mal renseignée).',
    key_points: {
      blockers: ['Annexe 6 devis unitaires obligatoire sans modèle fourni — risque d\'erreur de format'],
      risks: [
        'Fréquences week-end non définies précisément (art. 3.2)',
        'Clause résolutoire si 3 pénalités consécutives (art. 12.4)',
        'Délai de reprise de 4h ouvrées exigible 7j/7',
      ],
      strengths: [
        'CCTP clair sur les surfaces et volumes',
        'Critères d\'attribution explicitement listés',
      ],
      opportunities: ['Marge de négociation sur les horaires week-end non définis'],
    },
    raw_content:
      '# Lecture critique du cahier des charges\n\n## Points de vigilance\n[Mock] Les articles 3.2 et 12.4 méritent une attention particulière lors de la rédaction de l\'offre.',
  },
  memoire_technique: {
    summary:
      '[Mock] Mémoire technique attendu de 30 pages maximum incluant méthodologie, fiches produits Écolabel et plan qualité. Exigence forte sur la traçabilité (logiciel de reporting requis). Notre certification ISO 14001 constitue un atout majeur. Lacune identifiée : pas de référence récente sur ce type de site.',
    key_points: {
      strengths: ['Certification ISO 14001 correspond à l\'exigence section 5.3', 'Plan qualité déjà formalisé réutilisable'],
      risks: ['Logiciel de reporting temps réel requis — à vérifier si notre outil est compatible', 'Référence similaire récente (< 3 ans) exigée'],
      blockers: [],
      opportunities: ['Section innovation vide dans le CDC — terrain idéal pour valoriser nos outils numériques'],
    },
    raw_content:
      '# Plan de mémoire technique suggéré\n\n## 1. Présentation de l\'entreprise\n[Mock] À adapter avec nos références locales.\n\n## 2. Méthodologie\n[Mock] Décrire nos protocoles de nettoyage adaptés aux surfaces concernées.',
  },
  contradicteur: {
    summary:
      '[Mock] Avis très réservé sur ce marché. Le critère prix à 60% va déclencher une guerre tarifaire. La clause de reprise 4h/7j est opérationnellement très contraignante. La reconduction est optionnelle côté acheteur, pas côté prestataire. Rentabilité incertaine en dessous de 3 ETP dédiés.',
    key_points: {
      blockers: ['Délai de reprise 4h ouvrées 7j/7 — irréaliste sans équipe d\'astreinte dédiée'],
      risks: [
        'Critère prix 60% : risque de « mieux-disance tarifaire » par un concurrent low-cost',
        'Reconduction à la seule discrétion de l\'acheteur (art. 2.5) — pas de sécurité réelle',
        'Pénalités cumulatives : 3 manquements = résiliation automatique',
        'Pas de clause de révision des prix indexée — inflation absorbée par le prestataire',
      ],
      strengths: ['Durée initiale 3 ans limite les risques de volume non confirmé'],
      opportunities: ['Si on passe, le marché offre une visibilité intéressante'],
    },
    raw_content:
      '# Analyse contradictoire\n\n## Pourquoi être prudent\n[Mock] Ce marché cumule plusieurs facteurs de risque qui méritent un passage en comité d\'engagement avant toute soumission.',
  },
  financier: {
    summary:
      '[Mock] Marché estimé à 80-120k€/an sur base 5 000 m². Marge nette cible 12-15% après charges fixes. Risque principal : pénalités de retard à 0,5% par jour plafonné à 5%. Seuil de rentabilité atteint dès le 4e mois si facturation mensuelle.',
    key_points: {
      metrics: {
        revenue_year: '100k€',
        margin_target: '13%',
        headcount_needed: '3-4 ETP',
        cost_per_sqm: '9-11 €/m²',
      },
      risks: [
        'Pénalités jusqu\'à 5% du marché (5 000€/an) si incidents répétés',
        'Volatilité prix produits Écolabel (+8% YoY)',
        'Pas de clause de révision de prix dans le CDC',
      ],
      opportunities: ['Reconduction tacite potentielle +2 ans (120-240k€ CA additionnel)', 'Volume modulable à la hausse selon satisfaction'],
    },
    raw_content:
      '# Modèle économique\n\n## Hypothèses\n[Mock] Surface : 5 000 m², fréquence : 5j/7, 2h/jour.\n\n## Compte d\'exploitation prévisionnel\n[Mock] CA : 100k€ | Charges MO : 62k€ | Consommables : 8k€ | Frais généraux : 17k€ | Marge : 13k€.',
  },
  terrain: {
    summary:
      '[Mock] Site tertiaire 5 000 m² sur 3 niveaux, accès badge requis, horaires contraints 6h-8h le matin. Pas de local de stockage dédié prévu — à négocier. Autolaveuse indispensable pour les halls. Recrutement local faisable, délai estimé 3 semaines.',
    key_points: {
      metrics: {
        total_sqm: '5 000 m²',
        interventions_per_week: '5j/7',
        special_equipment: 'Autolaveuse + aspirateur eau & poussière',
      },
      risks: [
        'Pas de local de stockage sur site — à négocier en phase contractuelle',
        'Horaires contraints 6h-8h incompatibles avec certains profils de recrutement',
        'Accès badge : délai d\'habilitation estimé 2-3 semaines',
      ],
      blockers: [],
      opportunities: ['Possibilité d\'optimiser la tournée avec le site voisin de la même zone'],
    },
    raw_content:
      '# Plan opérationnel préliminaire\n\n## Organisation des équipes\n[Mock] 2 agents le matin (6h-8h) + 1 agent pour les sanitaires (13h-14h).\n\n## Matériels\n[Mock] Autolaveuse poussée : 1 unité. Chariots biactifs : 2 unités.',
  },
  conformite: {
    summary:
      '[Mock] Niveau d\'exigence réglementaire élevé : Écolabel requis pour les produits, certification Qualipropre recommandée, clauses sociales art. 14 applicables. Nous satisfaisons 6 des 8 exigences identifiées. Deux certifications manquantes (Qualipropre, MASE) à obtenir ou justifier.',
    key_points: {
      blockers: ['Certification MASE exigée si prestation en milieu sensible (art. 8.3) — non détenue'],
      risks: [
        'Certification Qualipropre non détenue — attendue mais non éliminatoire',
        'Clause sociale art. 14 : obligation de reprise du personnel sortant à vérifier',
        'Registre DUER à jour exigible dans le dossier',
      ],
      strengths: [
        'ISO 14001 : certifiés — répond à l\'exigence section 5.3',
        'Produits Écolabel : déjà référencés dans notre catalogue',
        'Formation CQP APH : 80% de nos agents certifiés',
      ],
      opportunities: ['Clause sociale art. 14 peut jouer en notre faveur si on reprend le personnel sortant (image RSE)'],
    },
    raw_content:
      '# Checklist de conformité\n\n## Certifications\n| Exigence | Statut | Action |\n|---|---|---|\n| ISO 14001 | ✅ OK | — |\n| Écolabel produits | ✅ OK | Joindre fiches |\n| Qualipropre | ⚠️ Manquant | Dossier à initier |\n| MASE | ❌ Bloquant | Art. 8.3 à vérifier |\n\n## Clauses sociales\n[Mock] Contacter RH pour liste du personnel prestataire sortant.',
  },
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface InitialAnalysisInput {
  agentName: ChatAgentName
  rawText: string
  libraryContext: string
  userId: string | null
}

export async function runInitialAnalysisAgent(input: InitialAnalysisInput): Promise<InitialAnalysisResult> {
  const { agentName, rawText, libraryContext, userId } = input
  const prompt = PROMPT_MAP[agentName]
  const provider = getAIProvider()
  const feature = `init_analysis_${agentName}`

  const result = await withAITracking(
    feature,
    userId,
    async () => {
      let userMessage: string
      let parsed: z.infer<typeof analysisOutputSchema> | undefined

      if (provider.name === 'mock') {
        const fixture = MOCK_FIXTURES[agentName]
        userMessage = `__MOCK_FIXTURE__:${JSON.stringify(fixture)}`
      } else {
        userMessage = [
          '=== DOCUMENT AO (texte extrait) ===',
          rawText.slice(0, 30000),
          '',
          '=== CONTEXTE BIBLIOTHÈQUE AGP ===',
          libraryContext.slice(0, 8000),
          '',
          'Produis ton analyse initiale en JSON selon le schéma fourni dans ton system prompt.',
        ].join('\n')
      }

      const output = await provider.complete({
        systemPrompt: prompt.system,
        userMessage,
        responseSchema: analysisOutputSchema,
        modelTier: prompt.modelTier,
      })

      // Parse the result
      if (output.parsed !== undefined && output.parsed !== null) {
        const parseResult = analysisOutputSchema.safeParse(output.parsed)
        if (parseResult.success) {
          parsed = parseResult.data
        }
      }

      // Fallback: try to parse raw text as JSON
      if (parsed === undefined) {
        try {
          const rawParsed = JSON.parse(output.text)
          const parseResult = analysisOutputSchema.safeParse(rawParsed)
          if (parseResult.success) {
            parsed = parseResult.data
          }
        } catch {
          // ignore
        }
      }

      if (parsed === undefined) {
        throw new Error(`[runInitialAnalysisAgent] Failed to parse output for agent ${agentName}`)
      }

      return {
        result: parsed,
        tokens: output.tokens,
        model: output.model,
        provider: provider.name as AIProviderName,
        durationMs: output.durationMs,
      }
    }
  )

  const metadata: Record<string, unknown> = {
    provider: provider.name,
    prompt_version: prompt.version,
    agent: agentName,
  }

  return {
    summary: result.summary,
    keyPoints: result.key_points,
    rawContent: result.raw_content ?? '',
    metadata,
  }
}
