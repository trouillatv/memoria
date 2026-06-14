import type {
  AnomalyCategory,
  InterventionSlot,
  InterventionStatus,
  MissionCadence,
  PhotoKind,
} from '@/types/db'

export const BATISUD_CLIENT_NAME = 'BatiSud Construction'
export const BATISUD_CONTRACT_NAME = 'BatiSud Construction - Démo gros œuvre'
export const BATISUD_ADRIEN_EMAIL = 'adrien@memoria.nc'
export const BATISUD_CHEF_EMAIL = 'chef.batisud@memoria.nc'
export const BATISUD_DEMO_PASSWORD = 'BatiSud!2026'

export interface BatiSudSiteSeed {
  name: string
  address: string
  contactName: string
  contactPhone: string
  accessInstructions: string
}

export const BATISUD_SITES: BatiSudSiteSeed[] = [
  {
    name: 'Chantier Lycée de Païta',
    address: 'Païta, zone scolaire sud',
    contactName: 'M. Riban - OPC',
    contactPhone: '+687 77 14 20',
    accessInstructions: 'Accès engins par portail nord avant 7h30, badge chantier obligatoire.',
  },
  {
    name: 'Extension Médipôle',
    address: 'Koutio, Nouméa',
    contactName: "Mme Vaki - Maîtrise d'œuvre",
    contactPhone: '+687 79 08 44',
    accessInstructions: 'Livraisons béton par entrée technique, contrôle sécurité à chaque passage.',
  },
  {
    name: 'Résidence Anse Vata',
    address: 'Anse Vata, Nouméa',
    contactName: 'M. Brial - Promoteur',
    contactPhone: '+687 74 66 03',
    accessInstructions: 'Stationnement limité, prévenir le voisinage avant opérations bruyantes.',
  },
  {
    name: 'Réhabilitation Port Autonome',
    address: 'Nouméa, zone portuaire',
    contactName: 'Mme Sipa - Exploitation portuaire',
    contactPhone: '+687 75 31 91',
    accessInstructions: "EPI haute visibilité et autorisation portuaire exigés à l'entrée.",
  },
]

export interface BatiSudTeamSeed {
  name: string
  color: string
  icon: string
}

export const BATISUD_TEAMS: BatiSudTeamSeed[] = [
  { name: 'Gros œuvre Nord', color: '#2563eb', icon: 'hard-hat' },
  { name: 'Sécurité & accès', color: '#dc2626', icon: 'shield-check' },
  { name: 'Finitions structure', color: '#16a34a', icon: 'wrench' },
]

export interface BatiSudTeamMemberSeed {
  email: string
  fullName: string
  phone: string
  teamName: string
  referent?: boolean
  commune: string
  employmentType: 'cdi' | 'cdd' | 'cdi_chantier'
}

export const BATISUD_TEAM_MEMBERS: BatiSudTeamMemberSeed[] = [
  {
    email: BATISUD_CHEF_EMAIL,
    fullName: 'Fred Martin',
    phone: '+687701235',
    teamName: 'Gros œuvre Nord',
    referent: true,
    commune: 'Dumbéa',
    employmentType: 'cdi_chantier',
  },
  {
    email: 'litia.batisud@memoria.nc',
    fullName: 'Litia Wane',
    phone: '+687701236',
    teamName: 'Gros œuvre Nord',
    commune: 'Païta',
    employmentType: 'cdi',
  },
  {
    email: 'manu.batisud@memoria.nc',
    fullName: 'Manu Kotra',
    phone: '+687701237',
    teamName: 'Gros œuvre Nord',
    commune: 'Mont-Dore',
    employmentType: 'cdd',
  },
  {
    email: 'sarah.batisud@memoria.nc',
    fullName: 'Sarah Neko',
    phone: '+687701238',
    teamName: 'Sécurité & accès',
    referent: true,
    commune: 'Nouméa',
    employmentType: 'cdi',
  },
  {
    email: 'joel.batisud@memoria.nc',
    fullName: 'Joël Tiaou',
    phone: '+687701239',
    teamName: 'Sécurité & accès',
    commune: 'Dumbéa',
    employmentType: 'cdi_chantier',
  },
  {
    email: 'noemie.batisud@memoria.nc',
    fullName: 'Noémie Bearune',
    phone: '+687701240',
    teamName: 'Finitions structure',
    referent: true,
    commune: 'Nouméa',
    employmentType: 'cdi',
  },
  {
    email: 'tino.batisud@memoria.nc',
    fullName: 'Tino Waya',
    phone: '+687701241',
    teamName: 'Finitions structure',
    commune: 'Païta',
    employmentType: 'cdi_chantier',
  },
]

export interface BatiSudMissionSeed {
  name: string
  cadence: MissionCadence
  checklist: string[]
  teamName: string
}

export const BATISUD_MISSIONS: BatiSudMissionSeed[] = [
  {
    name: 'Contrôle coulage dalle bâtiment B',
    cadence: 'weekly',
    teamName: 'Gros œuvre Nord',
    checklist: [
      'Contrôler accès camion pompe',
      'Vérifier présence plan béton v3',
      'Photographier zone avant coulage',
      'Consigner météo et état du sol',
    ],
  },
  {
    name: 'Vérification ferraillage voile Nord',
    cadence: 'weekly',
    teamName: 'Gros œuvre Nord',
    checklist: [
      'Comparer plan structure V4/V5',
      'Photographier ferraillage avant coffrage',
      'Relever avis bureau de contrôle',
      'Identifier réservations à maintenir',
    ],
  },
  {
    name: 'Contrôle implantation axes',
    cadence: 'biweekly',
    teamName: 'Finitions structure',
    checklist: [
      'Vérifier axes bleus géomètre',
      'Contrôler repères déplacés',
      'Noter écarts sur carnet chantier',
    ],
  },
  {
    name: 'Reprise réservations techniques',
    cadence: 'weekly',
    teamName: 'Finitions structure',
    checklist: [
      'Pointer réservations plomberie',
      'Comparer plan technique V4',
      'Photographier reprise avant fermeture',
    ],
  },
  {
    name: 'Sécurisation accès chantier',
    cadence: 'weekly',
    teamName: 'Sécurité & accès',
    checklist: [
      'Vérifier clôture et portails',
      'Contrôler cheminement camion pompe',
      'Consigner zones interdites au public',
    ],
  },
]

export interface BatiSudInterventionCompany {
  company_name: string
  role_description?: string
}

export interface BatiSudInterventionSeed {
  key: string
  siteName: string
  missionName: string
  title: string
  dayOffset: number
  slot: InterventionSlot
  plannedStart: string
  plannedEnd: string
  status: InterventionStatus
  teamName: string
  notes: string
  photos: Array<{ label: string; kind: PhotoKind }>
  anomaly?: {
    category: AnomalyCategory
    categoryOther?: string
    description: string
    resolved: boolean
  }
  validate: boolean
  companies: BatiSudInterventionCompany[]
}

const PAST_NOTES = [
  'Le coffrage du voile Nord a été renforcé après remarque du bureau de contrôle.',
  'Accès camion pompe difficile après 7h30, prévoir arrivée avant circulation école.',
  'Réservation plomberie déplacée de 40 cm suite à modification plan V4.',
  'Zone sud humide après fortes pluies, prévoir pompe de relevage avant coulage.',
  'Photos ferraillage à prendre impérativement avant fermeture du coffrage.',
  'SOCOTEC demande photo du ferraillage avant fermeture coffrage.',
  'Repères rouges déplacés de 3 mètres par le géomètre. Utiliser les axes bleus.',
  "Présence d'une nappe d'eau sous la zone sud après fortes pluies.",
]

export const BATISUD_SITE_NOTES: Array<{ siteName: string; body: string; kind: 'note' | 'a_savoir' }> = [
  { siteName: 'Chantier Lycée de Païta', body: "Présence d'une nappe d'eau sous la zone sud après fortes pluies.", kind: 'a_savoir' },
  { siteName: 'Chantier Lycée de Païta', body: 'Accès camion pompe difficile après 7h30, prévoir arrivée avant circulation école.', kind: 'a_savoir' },
  { siteName: 'Extension Médipôle', body: 'Repères rouges déplacés de 3 mètres par le géomètre. Utiliser les axes bleus.', kind: 'a_savoir' },
  { siteName: 'Extension Médipôle', body: 'SOCOTEC demande photo du ferraillage avant fermeture coffrage.', kind: 'a_savoir' },
  { siteName: 'Résidence Anse Vata', body: 'Réservation plomberie déplacée de 40 cm suite à modification plan V4.', kind: 'note' },
  { siteName: 'Résidence Anse Vata', body: 'Photos ferraillage à prendre impérativement avant fermeture du coffrage.', kind: 'a_savoir' },
  { siteName: 'Réhabilitation Port Autonome', body: 'Le coffrage du voile Nord a été renforcé après remarque du bureau de contrôle.', kind: 'note' },
  { siteName: 'Réhabilitation Port Autonome', body: 'Zone sud humide après fortes pluies, prévoir pompe de relevage avant coulage.', kind: 'a_savoir' },
]

export const BATISUD_DOCUMENTS = [
  {
    filename: 'Plan béton v3 - Lycée de Païta.pdf',
    type: 'procedure' as const,
    targetSiteName: 'Chantier Lycée de Païta',
    text: 'Plan béton v3. Zone sud à contrôler avant coulage. Prévoir pompe de relevage en cas de pluie.',
  },
  {
    filename: 'Rapport SOCOTEC ferraillage voile Nord.pdf',
    type: 'securite' as const,
    targetSiteName: 'Extension Médipôle',
    text: 'Rapport SOCOTEC. Photographies du ferraillage exigées avant fermeture du coffrage.',
  },
  {
    filename: 'Compte-rendu chantier - Réservations techniques.pdf',
    type: 'reference' as const,
    targetSiteName: 'Résidence Anse Vata',
    text: 'Compte-rendu chantier. Réservation plomberie déplacée de 40 cm suite à modification plan V4.',
  },
]

const SCHEDULE: Array<Omit<BatiSudInterventionSeed, 'notes' | 'photos' | 'validate' | 'companies'> & {
  photoLabel: string
}> = [
  { key: 'past-01', dayOffset: -13, siteName: 'Chantier Lycée de Païta', missionName: 'Contrôle coulage dalle bâtiment B', title: 'Coulage dalle bâtiment B - préparation zone sud', slot: 'morning', plannedStart: '06:30', plannedEnd: '09:30', status: 'validated', teamName: 'Gros œuvre Nord', photoLabel: 'Zone sud avant coulage' },
  { key: 'past-02', dayOffset: -11, siteName: 'Extension Médipôle', missionName: 'Vérification ferraillage voile Nord', title: 'Contrôle ferraillage voile Nord R+2', slot: 'morning', plannedStart: '07:00', plannedEnd: '10:00', status: 'completed', teamName: 'Gros œuvre Nord', photoLabel: 'Ferraillage voile Nord' },
  { key: 'past-03', dayOffset: -10, siteName: 'Résidence Anse Vata', missionName: 'Reprise réservations techniques', title: 'Reprise réservation technique plomberie', slot: 'afternoon', plannedStart: '13:00', plannedEnd: '15:30', status: 'validated', teamName: 'Finitions structure', photoLabel: 'Réservation plomberie V4' },
  { key: 'past-04', dayOffset: -8, siteName: 'Réhabilitation Port Autonome', missionName: 'Sécurisation accès chantier', title: 'Sécurisation accès zone portuaire', slot: 'morning', plannedStart: '07:30', plannedEnd: '09:00', status: 'completed', teamName: 'Sécurité & accès', photoLabel: 'Portail accès engins' },
  { key: 'past-05', dayOffset: -7, siteName: 'Chantier Lycée de Païta', missionName: 'Contrôle implantation axes', title: 'Contrôle implantation axes bleus', slot: 'afternoon', plannedStart: '14:00', plannedEnd: '16:00', status: 'completed', teamName: 'Finitions structure', photoLabel: 'Axes bleus géomètre' },
  { key: 'past-06', dayOffset: -5, siteName: 'Extension Médipôle', missionName: 'Contrôle coulage dalle bâtiment B', title: 'Vérification coffrage avant inspection', slot: 'morning', plannedStart: '06:45', plannedEnd: '09:45', status: 'validated', teamName: 'Gros œuvre Nord', photoLabel: 'Coffrage renforcé' },
  { key: 'past-07', dayOffset: -3, siteName: 'Résidence Anse Vata', missionName: 'Contrôle implantation axes', title: 'Contrôle implantation cage escalier', slot: 'morning', plannedStart: '08:00', plannedEnd: '10:30', status: 'completed', teamName: 'Finitions structure', photoLabel: 'Implantation cage escalier' },
  { key: 'past-08', dayOffset: -1, siteName: 'Réhabilitation Port Autonome', missionName: 'Reprise réservations techniques', title: 'Levée de réserve réservations techniques', slot: 'afternoon', plannedStart: '13:30', plannedEnd: '16:30', status: 'completed', teamName: 'Finitions structure', photoLabel: 'Réservations reprises' },
  { key: 'future-01', dayOffset: 1, siteName: 'Chantier Lycée de Païta', missionName: 'Contrôle coulage dalle bâtiment B', title: 'Coulage dalle - zone sud', slot: 'morning', plannedStart: '06:30', plannedEnd: '10:30', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Plan de coulage zone sud' },
  { key: 'future-02', dayOffset: 2, siteName: 'Extension Médipôle', missionName: 'Vérification ferraillage voile Nord', title: 'Contrôle ferraillage avant fermeture coffrage', slot: 'morning', plannedStart: '07:00', plannedEnd: '10:00', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Voile Nord à contrôler' },
  { key: 'future-03', dayOffset: 4, siteName: 'Résidence Anse Vata', missionName: 'Reprise réservations techniques', title: 'Reprise réservation technique gaine plomberie', slot: 'afternoon', plannedStart: '13:00', plannedEnd: '15:30', status: 'planned', teamName: 'Finitions structure', photoLabel: 'Gaine plomberie' },
  { key: 'future-04', dayOffset: 5, siteName: 'Réhabilitation Port Autonome', missionName: 'Sécurisation accès chantier', title: 'Sécurisation accès livraison béton', slot: 'morning', plannedStart: '07:30', plannedEnd: '09:30', status: 'planned', teamName: 'Sécurité & accès', photoLabel: 'Accès livraison béton' },
  { key: 'future-05', dayOffset: 7, siteName: 'Chantier Lycée de Païta', missionName: 'Vérification ferraillage voile Nord', title: 'Vérification coffrage et armatures', slot: 'morning', plannedStart: '07:00', plannedEnd: '10:30', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Armatures bâtiment B' },
  { key: 'future-06', dayOffset: 8, siteName: 'Extension Médipôle', missionName: 'Contrôle implantation axes', title: 'Contrôle implantation axes modifiés', slot: 'afternoon', plannedStart: '14:00', plannedEnd: '16:00', status: 'planned', teamName: 'Finitions structure', photoLabel: 'Axes modifiés' },
  { key: 'future-07', dayOffset: 10, siteName: 'Résidence Anse Vata', missionName: 'Sécurisation accès chantier', title: 'Sécurisation accès riverains', slot: 'morning', plannedStart: '08:00', plannedEnd: '09:30', status: 'planned', teamName: 'Sécurité & accès', photoLabel: 'Cheminement riverains' },
  { key: 'future-08', dayOffset: 12, siteName: 'Réhabilitation Port Autonome', missionName: 'Contrôle coulage dalle bâtiment B', title: 'Préparation inspection SOCOTEC', slot: 'morning', plannedStart: '06:45', plannedEnd: '09:45', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Prépa inspection SOCOTEC' },
  { key: 'future-09', dayOffset: 14, siteName: 'Chantier Lycée de Païta', missionName: 'Reprise réservations techniques', title: 'Levée de réserve réservations électriques', slot: 'afternoon', plannedStart: '13:30', plannedEnd: '16:00', status: 'planned', teamName: 'Finitions structure', photoLabel: 'Réserve électrique' },
  { key: 'future-10', dayOffset: 16, siteName: 'Extension Médipôle', missionName: 'Contrôle coulage dalle bâtiment B', title: 'Coulage dalle local technique', slot: 'morning', plannedStart: '06:30', plannedEnd: '10:30', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Local technique' },
  { key: 'future-11', dayOffset: 18, siteName: 'Résidence Anse Vata', missionName: 'Vérification ferraillage voile Nord', title: 'Contrôle ferraillage cages ascenseur', slot: 'morning', plannedStart: '07:00', plannedEnd: '10:00', status: 'planned', teamName: 'Gros œuvre Nord', photoLabel: 'Cage ascenseur' },
  { key: 'future-12', dayOffset: 20, siteName: 'Réhabilitation Port Autonome', missionName: 'Contrôle implantation axes', title: 'Contrôle implantation longrine quai', slot: 'afternoon', plannedStart: '14:00', plannedEnd: '16:30', status: 'planned', teamName: 'Finitions structure', photoLabel: 'Longrine quai' },
]

const COMPANIES: Record<string, BatiSudInterventionCompany[]> = {
  'past-01': [
    { company_name: 'Béton Services NC', role_description: "Fourniture et livraison béton prêt à l'emploi" },
    { company_name: 'Pompe Béton Pacifique', role_description: 'Location pompe à béton' },
  ],
  'past-02': [
    { company_name: 'Ferraillage Expert NC', role_description: 'Pose et contrôle armatures voile Nord' },
  ],
  'past-03': [
    { company_name: 'Plomberie du Pacifique', role_description: 'Réservations et raccordements plomberie' },
  ],
  'past-06': [
    { company_name: 'Béton Services NC', role_description: 'Fourniture béton coffrage' },
    { company_name: 'Menuiserie Coffrage NC', role_description: 'Fourniture coffrages bois' },
  ],
  'past-08': [
    { company_name: 'Étanchéité du Pacifique', role_description: 'Étanchéité réservations techniques' },
  ],
  'future-01': [
    { company_name: 'Béton Services NC', role_description: "Fourniture et livraison béton prêt à l'emploi" },
    { company_name: 'Pompe Béton Pacifique', role_description: 'Location pompe à béton' },
  ],
}

const NOTE_OVERRIDES: Record<string, string> = {
  "past-03": "Reprise réservation plomberie bâtiment C — décalage 40 cm validé plan V4. Plomberie du Pacifique présente tout l'après-midi.",
  "past-07": "Pose porte palière 42 bâtiment C — vérification menuiserie et serrurerie conforme plan V5. Fred Martin sur site, poses conformes aux cotes.",
}

const ANOMALIES: Record<string, BatiSudInterventionSeed['anomaly']> = {
  'past-01': { category: 'autre', categoryOther: 'Sol humide', description: "Présence d'une nappe d'eau sous la zone sud après fortes pluies.", resolved: true },
  'past-02': { category: 'autre', categoryOther: 'Ferraillage à reprendre', description: 'Armatures insuffisantes relevées sur le voile Nord avant correction.', resolved: true },
  'past-03': { category: 'materiel_casse', description: 'Réservation plomberie déplacée de 40 cm suite à modification plan V4.', resolved: true },
  'past-04': { category: 'acces_bloque', description: 'Accès camion pompe bloqué par véhicule extérieur après 7h30.', resolved: false },
  'past-05': { category: 'autre', categoryOther: 'Implantation', description: 'Repères rouges déplacés de 3 mètres par le géomètre, axes bleus à suivre.', resolved: true },
  'past-06': { category: 'autre', categoryOther: 'Coffrage', description: 'Coffrage du voile Nord fragile avant renfort complémentaire.', resolved: true },
  'past-07': { category: 'autre', categoryOther: 'Plan incohérent', description: 'Écart entre plan structure V3 et V5 sur cage escalier.', resolved: false },
  'future-02': { category: 'autre', categoryOther: 'Contrôle SOCOTEC', description: 'SOCOTEC demande photos du ferraillage avant fermeture coffrage.', resolved: false },
  'future-04': { category: 'acces_bloque', description: 'Risque de conflit entre livraison béton et circulation école.', resolved: false },
  'future-08': { category: 'autre', categoryOther: 'Inspection', description: 'Préparer dossier photo avant inspection SOCOTEC vendredi.', resolved: false },
}

export function toIsoDate(baseDate: Date, dayOffset: number): string {
  const d = new Date(baseDate)
  d.setDate(d.getDate() + dayOffset)
  return d.toISOString().slice(0, 10)
}

function truncateForSiteNote(raw: string, maxLength: number): string {
  const trimmed = raw.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function buildBatiSudSiteReturnNote(seed: BatiSudInterventionSeed): string {
  const prefix = `Retour ${seed.title} : `
  return `${prefix}${truncateForSiteNote(seed.notes, 140 - prefix.length)}`
}

export function buildBatiSudInterventionSeeds(baseDate = new Date()): BatiSudInterventionSeed[] {
  return SCHEDULE.map((item, index) => {
    const isPast = item.dayOffset < 0
    const note = NOTE_OVERRIDES[item.key] ?? (
      isPast
        ? PAST_NOTES[index % PAST_NOTES.length]
        : `Planifié le ${toIsoDate(baseDate, item.dayOffset)} : ${item.title.toLowerCase()}.`
    )
    const anomaly = ANOMALIES[item.key]
    return {
      ...item,
      notes: note,
      anomaly,
      companies: COMPANIES[item.key] ?? [],
      validate: item.status === 'validated',
      photos: isPast || anomaly
        ? [
            { label: item.photoLabel, kind: anomaly ? 'anomaly' : 'proof' },
            { label: `${item.siteName} - ${item.title}`, kind: item.status === 'planned' ? 'before' : 'proof' },
          ]
        : [],
    }
  })
}
