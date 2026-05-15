/**
 * scripts/dev/nc-data.ts
 *
 * Données de référence Nouvelle-Calédonie pour le seed de démonstration.
 * Organismes RÉELS cités à titre indicatif, AO 100% FICTIFS marqués [DEMO].
 *
 * Doctrine respectée :
 *   - Aucun KPI/score humain, aucune métrique de performance individuelle
 *   - Anonymisation des prénoms dans les exports publics
 *   - Anomalies = signal métier, jamais un blâme sur l'agent
 *
 * Voir docs/dev/nc-demo-seed.md
 */

import type {
  EngagementCategory,
  EngagementSourceType,
  AnomalyCategory,
} from '@/types/db'

// ============================================================================
// Comptes test (uniquement dev — voir safety guards dans le script principal)
// ============================================================================

export const TEST_PASSWORD = 'Password123!'

export interface TestAccount {
  email: string
  fullName: string
  role: 'admin' | 'manager' | 'chef_equipe'
  teamSlug?: 'noumea-centre' | 'grand-noumea' | 'nord-vkp'
}

export const TEST_ACCOUNTS: TestAccount[] = [
  {
    email: 'admin@memoria.local',
    fullName: 'Anaïs Wamytan',
    role: 'admin',
  },
  {
    email: 'manager@memoria.local',
    fullName: 'Jean-Marc Dubois',
    role: 'manager',
  },
  {
    email: 'chef.noumea@memoria.local',
    fullName: 'Moana Tjibaou',
    role: 'chef_equipe',
    teamSlug: 'noumea-centre',
  },
  {
    email: 'chef.grandnoumea@memoria.local',
    fullName: 'Sosefo Falelavaki',
    role: 'chef_equipe',
    teamSlug: 'grand-noumea',
  },
  {
    email: 'agent.demo@memoria.local',
    fullName: 'Tiare Liu',
    role: 'chef_equipe',
    teamSlug: 'noumea-centre',
  },
]

// ============================================================================
// Équipes (conteneurs logistiques — doctrine V2 : pas d'unité analytique)
// ============================================================================

export interface TeamSeed {
  slug: 'noumea-centre' | 'grand-noumea' | 'nord-vkp'
  name: string
  color: string
  members: string[] // full names — pour le seed team_members
}

export const TEAMS: TeamSeed[] = [
  {
    slug: 'noumea-centre',
    name: 'Équipe Nouméa Centre',
    color: '#0ea5e9', // sky
    members: ['Moana Tjibaou', 'Tiare Liu', 'Lino Boewa'],
  },
  {
    slug: 'grand-noumea',
    name: 'Équipe Grand Nouméa',
    color: '#10b981', // emerald
    members: ['Sosefo Falelavaki', 'Léa Nguyen', 'Karim Martin'],
  },
  {
    slug: 'nord-vkp',
    name: 'Équipe Nord / VKP',
    color: '#f59e0b', // amber
    members: ['Hnathalo Sipa', 'Lucie Vaki', 'Yann Legrand'],
  },
]

// ============================================================================
// Sites NC — communes et types crédibles
// ============================================================================

export interface SiteSeed {
  name: string
  address: string
  city:
    | 'Nouméa'
    | 'Dumbéa'
    | 'Mont-Dore'
    | 'Païta'
    | 'Koné'
    | 'Pouembout'
    | 'Lifou'
  contractKey: 'cht' | 'lycee-laperouse' | 'opt-nc' | 'dumbea-mall'
  contactName: string
  contactPhone: string // format NC : XX XX XX
}

export const SITES: SiteSeed[] = [
  // CHT Gaston-Bourret — 2 sites (bâtiment principal + annexe)
  {
    name: 'CHT Magenta — Bâtiment principal',
    address: '110 Bd Joseph Wamytan, Magenta',
    city: 'Nouméa',
    contractKey: 'cht',
    contactName: 'Dr. Bouteille (réf. service hygiène)',
    contactPhone: '25 66 66',
  },
  {
    name: 'CHT Magenta — Aile pédiatrie',
    address: '110 Bd Joseph Wamytan, Magenta',
    city: 'Nouméa',
    contractKey: 'cht',
    contactName: 'Mme Michel (cadre hygiène)',
    contactPhone: '25 66 70',
  },

  // Lycée Lapérouse — 1 site
  {
    name: 'Lycée Lapérouse — Centre-ville',
    address: '1 Rue Frédéric Surleau, Centre-ville',
    city: 'Nouméa',
    contractKey: 'lycee-laperouse',
    contactName: 'M. Legrand (intendance)',
    contactPhone: '27 35 80',
  },

  // OPT-NC — 2 sites (siège + agence Ducos)
  {
    name: 'OPT-NC — Siège (Ducos)',
    address: '7 Rue Eugène Porcheron, Ducos',
    city: 'Nouméa',
    contractKey: 'opt-nc',
    contactName: 'Mme Vaki (services généraux)',
    contactPhone: '26 87 00',
  },
  {
    name: 'OPT-NC — Agence Koné',
    address: 'Rue de Téari Tein, Koné',
    city: 'Koné',
    contractKey: 'opt-nc',
    contactName: 'M. Tui (responsable agence)',
    contactPhone: '47 22 30',
  },

  // Dumbéa Mall — 1 site
  {
    name: 'Dumbéa Mall — Parties communes',
    address: 'RT1 Dumbéa-sur-Mer',
    city: 'Dumbéa',
    contractKey: 'dumbea-mall',
    contactName: 'M. Katrawa (direction technique)',
    contactPhone: '41 50 00',
  },
]

// ============================================================================
// Contrats / Tenders
// ============================================================================

export interface ContractSeed {
  key: 'cht' | 'lycee-laperouse' | 'opt-nc' | 'dumbea-mall'
  clientName: string
  contractName: string
  tenderTitle: string
  tenderExtractedText: string
  technicalMemo: string
  summary: string
  engagements: EngagementSeed[]
}

export interface EngagementSeed {
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown>
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number
}

// ----- CHT Gaston-Bourret (Magenta) — bionettoyage hospitalier ---------------
const CHT_EXTRACTED = `[DEMO — DONNÉES DE DÉMONSTRATION] APPEL D'OFFRES NETTOYAGE
CHT Gaston-Bourret — Lot bionettoyage des locaux du site de Magenta
Référence interne fictive : CHT-2026-NETT-MAG-DEMO

Durée du marché : 24 mois renouvelables une fois.
Surface totale : ~8 200 m² répartis entre le bâtiment principal et l'aile pédiatrie.

1. PRESTATIONS ATTENDUES

L'attributaire effectuera un bionettoyage biquotidien des sanitaires et zones à risque infectieux avec produits écolabel. Les fréquences seront respectées : 2x/jour pour les sanitaires, 1x/jour pour les couloirs et salles d'attente, 1x/semaine pour les vitres.

2. EXIGENCES QUALITÉ

Personnel formé au bionettoyage en milieu hospitalier (CQP APH ou équivalent). Un contrôle hebdomadaire par chef d'équipe avec rapport écrit au service hygiène.

3. CONTEXTE NOUVELLE-CALÉDONIE

L'attributaire devra adapter ses produits à la saison chaude (humidité élevée, prolifération microbienne accrue) et prévoir une intervention renforcée après épisode de fortes pluies (canalisations, sols).

4. NIVEAU DE SERVICE

Intervention sous 4 heures ouvrées en cas d'incident sanitaire signalé. Reporting mensuel avec photos avant/après par zone critique, transmis au plus tard le 5 du mois suivant.

5. CONFIDENTIALITÉ

Personnel signataire d'une charte de confidentialité. Aucune photographie incluant des patients.`

const CHT_MEMOIRE = `# Mémoire technique — Réponse [DEMO] CHT Gaston-Bourret

## 1. Notre approche du bionettoyage hospitalier en contexte NC

Nous nous engageons à effectuer le bionettoyage biquotidien des sanitaires avec produits écolabel adaptés au climat tropical (humidité élevée). Notre équipe dédiée est formée au CQP APH ou équivalent.

## 2. Adaptation saison chaude et épisodes pluvieux

Nous mobilisons des produits désinfectants à action prolongée pendant la saison chaude. Après chaque épisode de fortes pluies, une intervention renforcée est planifiée sur les zones sensibles (canalisations, sols humides, accès véhicules).

## 3. Contrôle qualité

Contrôle hebdomadaire par notre chef d'équipe avec rapport écrit transmis au service hygiène du CHT. Photos avant/après horodatées pour chaque zone critique.

## 4. Engagement de service

Intervention sous 4 heures ouvrées en cas d'incident sanitaire signalé. Astreinte joignable. Reporting mensuel structuré avant le 5 du mois suivant.

## 5. Confidentialité

Personnel signataire de la charte de confidentialité du CHT, formé au respect du secret médical. Aucune photographie patient.`

// ----- Lycée Lapérouse (centre-ville) — entretien général --------------------
const LAPEROUSE_EXTRACTED = `[DEMO — DONNÉES DE DÉMONSTRATION] APPEL D'OFFRES NETTOYAGE
Lycée Lapérouse — Entretien des locaux scolaires
Référence interne fictive : LAP-2026-NETT-DEMO

Durée : 12 mois renouvelables. Surface : ~4 500 m² (salles de classe, sanitaires, administration, internat).

1. PRESTATIONS

Nettoyage quotidien des salles de classe en dehors des heures de cours. Sanitaires nettoyés 2x/jour. Désinfection des poignées, interrupteurs et zones de contact 2x/jour pendant les périodes scolaires.

2. SPÉCIFICITÉS

Travail en dehors des heures pédagogiques (avant 7h30 ou après 17h pour les salles, créneaux dédiés pour les sanitaires). Pas d'accès pendant les conseils de classe ou réunions parents-professeurs.

3. PRODUITS

Produits adaptés présence d'élèves : pas de produits agressifs ou parfumés intensément. Stockage produits sécurisé hors d'accès des élèves.

4. REPORTING

Compte-rendu mensuel auprès de l'intendance avec relevé des consommables (savon, papier).`

const LAPEROUSE_MEMOIRE = `# Mémoire technique — Réponse [DEMO] Lycée Lapérouse

## 1. Adaptation rythme scolaire

Nous adaptons nos plages horaires au rythme du lycée : nettoyage des salles avant 7h30 et après 17h, sanitaires nettoyés en créneaux dédiés (interclasses ou récréations) pour ne jamais gêner l'enseignement.

## 2. Désinfection zones de contact

Désinfection biquotidienne des poignées, interrupteurs et rampes pendant les périodes scolaires, avec produits sans parfum intense compatibles avec la présence d'élèves sensibles.

## 3. Sécurité produits

Stockage des produits dans local technique fermé à clef, hors d'accès des élèves. Fiches de données de sécurité affichées sur place.

## 4. Reporting et consommables

Compte-rendu mensuel transmis à l'intendance avec relevé des consommables (savon, essuie-tout, papier toilette) pour anticipation des recommandes.`

// ----- OPT-NC (siège Ducos + agence Koné) — bureaux et agences --------------
const OPT_EXTRACTED = `[DEMO — DONNÉES DE DÉMONSTRATION] APPEL D'OFFRES NETTOYAGE
OPT-NC — Entretien des bureaux et agences (Siège Ducos + Agence Koné)
Référence interne fictive : OPT-2026-NETT-DEMO

Durée : 36 mois fermes. Surface cumulée : ~2 800 m².

1. PRESTATIONS COURANTES

Entretien des bureaux les jours ouvrés (lundi-vendredi) en dehors des horaires de réception du public. Vidage des poubelles avant 10h chaque jour ouvré. Nettoyage des parties communes (hall, escaliers, ascenseurs) quotidien.

2. PRESTATIONS HEBDOMADAIRES

Nettoyage des vitres intérieures et façades vitrées d'agence (impact image). Aspiration approfondie des moquettes.

3. AGENCE KONÉ — SPÉCIFICITÉS

Couverture par équipe basée VKP. Coordination avec le responsable d'agence pour les interventions hors horaires d'ouverture. Climat humide à prendre en compte (moisissures).

4. SIGNALEMENT

Signalement immédiat de toute dégradation, accès bloqué ou dysfonctionnement remarqué (lumière, eau, plomberie).`

const OPT_MEMOIRE = `# Mémoire technique — Réponse [DEMO] OPT-NC

## 1. Couverture multi-sites Province Sud + Nord

Notre organisation permet de couvrir simultanément le siège OPT à Ducos (équipe Grand Nouméa) et l'agence de Koné (équipe Nord/VKP), avec coordination centrale via notre application mobile.

## 2. Respect des horaires de réception du public

Toutes les prestations courantes sont planifiées en dehors des horaires de réception. Vidage poubelles avant 10h, parties communes nettoyées tôt le matin.

## 3. Adaptation climat humide

Pour l'agence de Koné particulièrement, nous utilisons des produits anti-moisissures sur les zones sensibles (sanitaires, fenêtres, joints). Inspection visuelle hebdomadaire.

## 4. Signalement et traçabilité

Tout incident, dégradation ou accès bloqué est signalé via notre application avec photo géolocalisée (intervention seule, jamais le public). Réponse sous 24h.`

// ----- Dumbéa Mall — parties communes + sanitaires --------------------------
const DUMBEA_EXTRACTED = `[DEMO — DONNÉES DE DÉMONSTRATION] APPEL D'OFFRES NETTOYAGE
Dumbéa Mall — Nettoyage des sanitaires et parties communes
Référence interne fictive : DBM-2026-NETT-DEMO

Durée : 18 mois. Surface : ~3 500 m² (galeries, sanitaires publics, food court).

1. SANITAIRES PUBLICS

Nettoyage continu pendant les heures d'ouverture (9h-21h), rotation toutes les 2 heures minimum. Vérification des consommables à chaque passage.

2. PARTIES COMMUNES

Aspiration et lavage des galeries 2x/jour (avant ouverture + milieu de journée). Food court : nettoyage des tables et sols immédiatement après pic de fréquentation (12h-14h, 19h-20h).

3. INCIDENTS

Intervention immédiate sur tout incident signalé (liquide renversé, sanitaire dégradé, accumulation). Présence physique d'un agent pendant toute la plage d'ouverture.

4. CONTEXTE TROPICAL

Renforcement après épisodes pluvieux pour gestion des sols glissants (signalétique + nettoyage rapide).`

const DUMBEA_MEMOIRE = `# Mémoire technique — Réponse [DEMO] Dumbéa Mall

## 1. Présence continue pendant les heures d'ouverture

Nous garantissons la présence permanente d'au moins un agent pendant toute la plage 9h-21h. Rotations sanitaires toutes les 2 heures minimum, avec relevé visuel des consommables (papier, savon).

## 2. Pic food court

Nettoyage immédiat des tables et sols après les pics de fréquentation 12h-14h et 19h-20h. Agent dédié pendant ces créneaux.

## 3. Sols glissants en saison des pluies

Mise en place rapide de signalétique "sol glissant" + lavage immédiat à chaque entrée d'eau. Protocole formalisé avec la direction technique du centre.

## 4. Incident management

Intervention sous 10 minutes sur tout incident signalé (liquide renversé, sanitaire dégradé). Application mobile pour traçabilité des interventions et photos.`

// ----- ContractSeeds (assemblage) --------------------------------------------

export const CONTRACTS: ContractSeed[] = [
  {
    key: 'cht',
    clientName: 'CHT Gaston-Bourret',
    contractName: 'CHT Magenta — Bionettoyage hospitalier',
    tenderTitle: '[DEMO] CHT Gaston-Bourret — Bionettoyage Magenta',
    tenderExtractedText: CHT_EXTRACTED,
    technicalMemo: CHT_MEMOIRE,
    summary:
      "Bionettoyage hospitalier 2 bâtiments (~8 200 m²). 24 mois renouvelables. Personnel CQP APH, produits écolabel, adaptation climat tropical. SLA reprise 4h. Reporting mensuel structuré photos avant/après.",
    engagements: [
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Bionettoyage biquotidien des sanitaires avec produits écolabel',
        source_ref: { page: 1, section: '1' },
        category: 'frequency',
        short_label: 'Sanitaires bionettoyage 2x/jour écolabel',
        measurable: true,
        ai_confidence: 0.95,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Personnel formé au bionettoyage en milieu hospitalier (CQP APH)',
        source_ref: { page: 1, section: '2' },
        category: 'quality',
        short_label: 'Équipe certifiée CQP APH',
        measurable: false,
        ai_confidence: 0.91,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Intervention renforcée après épisode de fortes pluies',
        source_ref: { page: 1, section: '3' },
        category: 'sla',
        short_label: 'Intervention renforcée post-pluies',
        measurable: false,
        ai_confidence: 0.88,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Intervention sous 4 heures ouvrées en cas d\'incident sanitaire',
        source_ref: { page: 1, section: '4' },
        category: 'sla',
        short_label: 'Reprise sous 4h ouvrées 7j/7',
        measurable: true,
        ai_confidence: 0.96,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Reporting mensuel avec photos avant/après par zone critique',
        source_ref: { page: 1, section: '5' },
        category: 'reporting',
        short_label: 'Reporting mensuel photos avant/après',
        measurable: true,
        ai_confidence: 0.94,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Personnel signataire d\'une charte de confidentialité, secret médical',
        source_ref: { page: 1, section: '6' },
        category: 'compliance',
        short_label: 'Charte confidentialité + secret médical',
        measurable: false,
        ai_confidence: 0.93,
      },
    ],
  },
  {
    key: 'lycee-laperouse',
    clientName: 'Lycée Lapérouse',
    contractName: 'Lycée Lapérouse — Entretien général',
    tenderTitle: '[DEMO] Lycée Lapérouse — Entretien des locaux scolaires',
    tenderExtractedText: LAPEROUSE_EXTRACTED,
    technicalMemo: LAPEROUSE_MEMOIRE,
    summary:
      "Entretien lycée 4 500 m² (salles, sanitaires, internat). 12 mois renouvelables. Horaires hors-cours, désinfection biquotidienne zones de contact, produits sans parfum, stockage sécurisé.",
    engagements: [
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Nettoyage quotidien des salles de classe en dehors des heures de cours',
        source_ref: { page: 1, section: '1' },
        category: 'frequency',
        short_label: 'Salles nettoyées hors cours quotidien',
        measurable: true,
        ai_confidence: 0.93,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Désinfection biquotidienne des poignées, interrupteurs et zones de contact',
        source_ref: { page: 1, section: '1' },
        category: 'frequency',
        short_label: 'Désinfection zones contact 2x/jour',
        measurable: true,
        ai_confidence: 0.94,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Produits sans parfum intense compatibles présence d\'élèves',
        source_ref: { page: 1, section: '3' },
        category: 'quality',
        short_label: 'Produits adaptés présence élèves',
        measurable: false,
        ai_confidence: 0.86,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Stockage des produits dans local technique fermé à clef',
        source_ref: { page: 1, section: '3' },
        category: 'compliance',
        short_label: 'Stockage produits sécurisé',
        measurable: false,
        ai_confidence: 0.89,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Compte-rendu mensuel avec relevé des consommables',
        source_ref: { page: 1, section: '4' },
        category: 'reporting',
        short_label: 'Reporting mensuel + consommables',
        measurable: true,
        ai_confidence: 0.91,
      },
    ],
  },
  {
    key: 'opt-nc',
    clientName: 'OPT-NC',
    contractName: 'OPT-NC — Bureaux et agences',
    tenderTitle: "[DEMO] OPT-NC — Entretien bureaux Ducos + agence Koné",
    tenderExtractedText: OPT_EXTRACTED,
    technicalMemo: OPT_MEMOIRE,
    summary:
      "Entretien multi-sites Province Sud + Nord (2 800 m²). 36 mois fermes. Couverture coordonnée Ducos + Koné, hors heures réception, anti-moisissures, signalement immédiat dégradations.",
    engagements: [
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Vidage des poubelles avant 10h chaque jour ouvré',
        source_ref: { page: 1, section: '1' },
        category: 'frequency',
        short_label: 'Vidage poubelles avant 10h JO',
        measurable: true,
        ai_confidence: 0.92,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Toutes les prestations courantes en dehors des horaires de réception',
        source_ref: { page: 1, section: '2' },
        category: 'sla',
        short_label: 'Prestations hors heures public',
        measurable: false,
        ai_confidence: 0.87,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Nettoyage vitres intérieures et façades vitrées hebdomadaire',
        source_ref: { page: 1, section: '2' },
        category: 'frequency',
        short_label: 'Vitres + façades 1x/semaine',
        measurable: true,
        ai_confidence: 0.90,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Produits anti-moisissures sur zones sensibles agence Koné',
        source_ref: { page: 1, section: '3' },
        category: 'quality',
        short_label: 'Anti-moisissures Koné',
        measurable: false,
        ai_confidence: 0.83,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Signalement immédiat de toute dégradation ou accès bloqué',
        source_ref: { page: 1, section: '4' },
        category: 'reporting',
        short_label: 'Signalement immédiat incidents',
        measurable: false,
        ai_confidence: 0.89,
      },
    ],
  },
  {
    key: 'dumbea-mall',
    clientName: 'Dumbéa Mall',
    contractName: 'Dumbéa Mall — Parties communes & sanitaires',
    tenderTitle: '[DEMO] Dumbéa Mall — Sanitaires et parties communes',
    tenderExtractedText: DUMBEA_EXTRACTED,
    technicalMemo: DUMBEA_MEMOIRE,
    summary:
      "Galerie commerciale 3 500 m². 18 mois. Présence continue 9h-21h, rotation sanitaires 2h, intervention immédiate incidents, gestion sols glissants saison pluies.",
    engagements: [
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Rotation sanitaires toutes les 2 heures minimum pendant l\'ouverture',
        source_ref: { page: 1, section: '1' },
        category: 'frequency',
        short_label: 'Sanitaires rotation 2h durant ouverture',
        measurable: true,
        ai_confidence: 0.94,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Aspiration et lavage des galeries 2x/jour',
        source_ref: { page: 1, section: '2' },
        category: 'frequency',
        short_label: 'Galeries 2x/jour',
        measurable: true,
        ai_confidence: 0.93,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Présence permanente d\'au moins un agent pendant 9h-21h',
        source_ref: { page: 1, section: '3' },
        category: 'sla',
        short_label: 'Présence continue 9h-21h',
        measurable: true,
        ai_confidence: 0.95,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Intervention sous 10 minutes sur tout incident signalé',
        source_ref: { page: 1, section: '3' },
        category: 'sla',
        short_label: 'Reprise 10 min incidents',
        measurable: true,
        ai_confidence: 0.96,
      },
      {
        source_type: 'memoire_engagement',
        source_excerpt: 'Signalétique sol glissant + lavage immédiat à chaque entrée d\'eau',
        source_ref: { page: 1, section: '4' },
        category: 'sla',
        short_label: 'Protocole sols glissants pluies',
        measurable: false,
        ai_confidence: 0.88,
      },
    ],
  },
]

// ============================================================================
// Missions récurrentes (par contractKey)
// ============================================================================

export interface MissionSeed {
  siteName: string
  missionName: string
  cadence: 'daily' | 'weekly' | 'monthly'
  frequency: 'daily' | 'weekly' | 'monthly'
  slots: Array<'morning' | 'afternoon' | 'evening'>
  dayOfWeek?: number // 1=lundi
  dayOfMonth?: number
  description?: string
  checklistItems: Array<{ label: string; required: boolean; sort_order: number }>
}

export const MISSIONS: MissionSeed[] = [
  // CHT — bâtiment principal
  {
    siteName: 'CHT Magenta — Bâtiment principal',
    missionName: 'Bionettoyage sanitaires',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning', 'afternoon'],
    description: 'Sanitaires biquotidiens — produits écolabel — secret médical',
    checklistItems: [
      { label: 'Vérifier consommables (savon, papier)', required: true, sort_order: 1 },
      { label: 'Nettoyer cuvettes WC + sol', required: true, sort_order: 2 },
      { label: 'Désinfection lavabos + miroirs', required: true, sort_order: 3 },
      { label: 'Désinfection poignées + boutons chasse', required: true, sort_order: 4 },
      { label: 'Vidage poubelles', required: true, sort_order: 5 },
      { label: 'Photo après — vérification visuelle', required: false, sort_order: 6 },
    ],
  },
  {
    siteName: 'CHT Magenta — Bâtiment principal',
    missionName: 'Couloirs + salles d\'attente',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning'],
    description: 'Lavage couloirs + dépoussiérage salles d\'attente',
    checklistItems: [
      { label: 'Aspiration tapis salles d\'attente', required: true, sort_order: 1 },
      { label: 'Lavage sol couloirs', required: true, sort_order: 2 },
      { label: 'Désinfection sièges et accoudoirs', required: true, sort_order: 3 },
      { label: 'Vidage poubelles', required: true, sort_order: 4 },
    ],
  },
  // CHT — aile pédiatrie
  {
    siteName: 'CHT Magenta — Aile pédiatrie',
    missionName: 'Bionettoyage zones pédiatrie',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning', 'afternoon'],
    description: 'Bionettoyage adapté pédiatrie — produits doux',
    checklistItems: [
      { label: 'Désinfection plans de change', required: true, sort_order: 1 },
      { label: 'Nettoyage jouets espace attente', required: true, sort_order: 2 },
      { label: 'Sanitaires pédiatrie', required: true, sort_order: 3 },
      { label: 'Sols salle de jeux', required: true, sort_order: 4 },
    ],
  },

  // Lycée Lapérouse
  {
    siteName: 'Lycée Lapérouse — Centre-ville',
    missionName: 'Entretien salles de classe',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['evening'],
    description: 'Nettoyage salles après cours — produits sans parfum',
    checklistItems: [
      { label: 'Aspirer ou balayer sols', required: true, sort_order: 1 },
      { label: 'Vidage poubelles + corbeilles', required: true, sort_order: 2 },
      { label: 'Essuyage tableaux blancs', required: false, sort_order: 3 },
      { label: 'Désinfection poignées + interrupteurs', required: true, sort_order: 4 },
    ],
  },
  {
    siteName: 'Lycée Lapérouse — Centre-ville',
    missionName: 'Sanitaires lycéens',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning', 'afternoon'],
    description: 'Sanitaires nettoyés 2x/jour pendant interclasses',
    checklistItems: [
      { label: 'WC + cuvettes', required: true, sort_order: 1 },
      { label: 'Lavabos + miroirs', required: true, sort_order: 2 },
      { label: 'Sol', required: true, sort_order: 3 },
      { label: 'Consommables', required: true, sort_order: 4 },
    ],
  },

  // OPT-NC siège Ducos
  {
    siteName: 'OPT-NC — Siège (Ducos)',
    missionName: 'Entretien bureaux',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning'],
    description: 'Bureaux jours ouvrés — avant 8h',
    checklistItems: [
      { label: 'Vidage poubelles bureaux', required: true, sort_order: 1 },
      { label: 'Lavage parties communes (hall, escaliers)', required: true, sort_order: 2 },
      { label: 'Aspiration moquettes', required: false, sort_order: 3 },
      { label: 'Désinfection sanitaires étages', required: true, sort_order: 4 },
    ],
  },
  {
    siteName: 'OPT-NC — Siège (Ducos)',
    missionName: 'Vitres + façades',
    cadence: 'weekly',
    frequency: 'weekly',
    slots: ['morning'],
    dayOfWeek: 5, // vendredi
    description: 'Nettoyage hebdomadaire vendredi matin',
    checklistItems: [
      { label: 'Vitres intérieures hall', required: true, sort_order: 1 },
      { label: 'Façade vitrée entrée', required: true, sort_order: 2 },
      { label: 'Cloisons vitrées open-space', required: false, sort_order: 3 },
    ],
  },
  // OPT-NC agence Koné
  {
    siteName: 'OPT-NC — Agence Koné',
    missionName: 'Entretien agence',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning'],
    description: 'Agence Koné — avant ouverture au public 8h',
    checklistItems: [
      { label: 'Sanitaires public + personnel', required: true, sort_order: 1 },
      { label: 'Sol espace accueil', required: true, sort_order: 2 },
      { label: 'Bureaux back-office', required: true, sort_order: 3 },
      { label: 'Inspection moisissures (climat humide)', required: false, sort_order: 4 },
    ],
  },

  // Dumbéa Mall
  {
    siteName: 'Dumbéa Mall — Parties communes',
    missionName: 'Sanitaires publics rotation',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning', 'afternoon', 'evening'],
    description: 'Rotation sanitaires toutes les 2h — 9h-21h',
    checklistItems: [
      { label: 'WC publics — vérification visuelle', required: true, sort_order: 1 },
      { label: 'Réapprovisionner papier + savon', required: true, sort_order: 2 },
      { label: 'Nettoyage sols sanitaires', required: true, sort_order: 3 },
      { label: 'Photo passage horodatée', required: false, sort_order: 4 },
    ],
  },
  {
    siteName: 'Dumbéa Mall — Parties communes',
    missionName: 'Galeries + food court',
    cadence: 'daily',
    frequency: 'daily',
    slots: ['morning', 'afternoon'],
    description: 'Galeries 2x/jour + pics food court',
    checklistItems: [
      { label: 'Lavage sols galeries', required: true, sort_order: 1 },
      { label: 'Nettoyage tables food court après 14h', required: true, sort_order: 2 },
      { label: 'Vidage corbeilles communes', required: true, sort_order: 3 },
      { label: 'Vérif sols glissants entrées', required: true, sort_order: 4 },
    ],
  },
]

// ============================================================================
// Anomalies réalistes NC
// ============================================================================

export interface AnomalySeed {
  category: AnomalyCategory
  description: string
  // si présent, % de probabilité de résolution dans l'historique
  resolutionRatio?: number
}

export const ANOMALY_TEMPLATES: AnomalySeed[] = [
  {
    category: 'acces_bloque',
    description: 'Accès bloqué — portail fermé à l\'arrivée matin, intervention décalée',
  },
  {
    category: 'eau_coupee',
    description: 'Eau coupée sur le site — impossible de procéder au nettoyage humide',
  },
  {
    category: 'autre',
    description: 'Coupure électrique généralisée — nettoyage à la lampe',
  },
  {
    category: 'autre',
    description: 'Forte pluie — sol boueux dans le hall, intervention renforcée nécessaire',
  },
  {
    category: 'autre',
    description: 'Vent fort — impossible d\'intervenir sur surfaces extérieures',
  },
  {
    category: 'autre',
    description: 'Déchets déposés hors zone prévue — désordre au point de collecte',
  },
  {
    category: 'materiel_casse',
    description: 'Sanitaires dégradés — porte WC endommagée signalée à la maintenance',
  },
  {
    category: 'produit_manquant',
    description: 'Produit désinfectant manquant dans le local technique — usage rationné',
  },
  {
    category: 'acces_bloque',
    description: 'Salle occupée par réunion imprévue — nettoyage reporté en fin de journée',
  },
  {
    category: 'acces_bloque',
    description: 'Zone non accessible suite à des travaux non signalés',
  },
]

// ============================================================================
// Variations photos (labels SVG)
// ============================================================================

export const PHOTO_LABELS = {
  before: [
    'Sanitaires — avant',
    'Couloir — avant',
    'Salle — avant',
    'Bureau — avant',
    'Galerie — avant',
    'Food court — avant',
  ],
  after: [
    'Sanitaires — après',
    'Couloir — après',
    'Salle — après',
    'Bureau — après',
    'Galerie — après',
    'Food court — après',
  ],
  proof: [
    'Conformité visuelle',
    'Zone validée',
    'Contrôle qualité',
    'Vérification chef d\'équipe',
  ],
  anomaly: [
    'Anomalie — accès bloqué',
    'Anomalie — sol humide',
    'Anomalie — dégradation',
    'Anomalie — produit manquant',
  ],
}
