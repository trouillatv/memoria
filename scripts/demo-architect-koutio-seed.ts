#!/usr/bin/env npx tsx
/**
 * Seed démo architecte — Atelier Bouvier / Résidence Koutio Horizon.
 * Dédié (ne modifie pas demo-capse-seed.ts). Idempotent, réexécutable.
 *
 * Usage :
 *   npx tsx scripts/demo-architect-koutio-seed.ts --dry-run
 *   npx tsx scripts/demo-architect-koutio-seed.ts --rollback --dry-run   (comptage, aucune écriture)
 *   npx tsx scripts/demo-architect-koutio-seed.ts --rollback            (suppression réelle, fail-closed — cf. assertRollbackEligible)
 *   npx tsx scripts/demo-architect-koutio-seed.ts                       (exécution réelle du seed)
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as https from 'node:https'
import { pathToFileURL } from 'node:url'

// ── Environnement ──────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envFile)) return
  for (const line of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const PROJECT_REF = 'srixnofmaydxouhucawn'
const SEED_KEY = 'koutio-horizon-v1'
const TODAY_STR = '2026-10-01'

// David Bouvier — compte réel réutilisé tel quel, jamais recréé ici.
const DAVID_ID = 'e9311b4a-db47-4532-908b-99b7ab03908d'
const DAVID_EMAIL = 'david.bouvier.test@memoria.nc'

// ── Garde-fous absolus ──────────────────────────────────────────────────────────
// Organisations protégées : jamais lues en écriture, jamais pointées par un id
// calculé par ce script. Vérifiées deux fois : statiquement (ci-dessous) et à
// l'exécution (verifyGuardrails, y compris en --dry-run).

const PROTECTED_ORGS: Record<string, string> = {
  'cace1711-f729-4a8e-90c2-20c394df9a46': 'CAPSE NC',
  '6bf8c046-361d-4d26-aa65-5b3608727962': 'CAPSE Démonstration',
  '3a666557-a84e-4d4b-a7f8-9bb4a48acfec': 'BatiSud Construction',
}

function assertSafeOrgId(id: string, context: string) {
  if (PROTECTED_ORGS[id]) {
    throw new Error(
      `GUARDRAIL: refus d'agir sur l'organisation protégée "${PROTECTED_ORGS[id]}" (${id}) — contexte: ${context}`,
    )
  }
}

function assertOrgIdPresent(id: string | null | undefined, context: string) {
  if (!id) {
    throw new Error(`GUARDRAIL: organization_id manquant — contexte: ${context}`)
  }
}

// ── UUID déterministe ──────────────────────────────────────────────────────────

function duid(key: string): string {
  const h = crypto.createHash('sha256').update(`${SEED_KEY}:${key}`).digest('hex')
  const y = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${y}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// ── HTTP ───────────────────────────────────────────────────────────────────────

function httpPost(
  hostname: string,
  urlPath: string,
  headers: Record<string, string | number>,
  body: string,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }) }
          catch { resolve({ status: res.statusCode!, data: raw }) }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function runSql(query: string): Promise<unknown[]> {
  if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN manquant dans .env.local')
  const res = await httpPost(
    'api.supabase.com',
    `/v1/projects/${PROJECT_REF}/database/query`,
    { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    JSON.stringify({ query }),
  )
  if (res.status >= 400) {
    throw new Error(`SQL ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}`)
  }
  return res.data as unknown[]
}

// ── Dates ──────────────────────────────────────────────────────────────────────

function pgTs(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00')
}

// ── SQL escaping ───────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (s == null) return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}
function escJson(obj: unknown): string {
  return esc(JSON.stringify(obj))
}
function escUuid(id: string | null | undefined): string {
  return id == null ? 'NULL' : `'${id}'`
}

// ════════════════════════════════════════════════════════════════════════════════
// IDENTIFIANTS DÉTERMINISTES
// ════════════════════════════════════════════════════════════════════════════════

const ORG_ID = duid('org:atelier-bouvier-demo')
assertSafeOrgId(ORG_ID, 'auto-check ORG_ID vs liste protégée (doit toujours échouer à matcher)')

const CLIENT_ID = duid('client:sci-koutio-horizon')
const SITE_ID = duid('site:koutio-horizon')
const MEMBERSHIP_DAVID_ID = duid('membership:david')

export { ORG_ID, CLIENT_ID, SITE_ID, duid, SEED_KEY, PROTECTED_ORGS, assertSafeOrgId, assertOrgIdPresent, DAVID_ID, DAVID_EMAIL }
// ROLLBACK_TABLES et assertRollbackEligible sont exportés plus bas, après leur déclaration.

// ════════════════════════════════════════════════════════════════════════════════
// DONNÉES STATIQUES — sociétés & contacts
// ════════════════════════════════════════════════════════════════════════════════

type CompanyDef = { key: string; name: string; role: string }
const COMPANIES: CompanyDef[] = [
  { key: 'atelier-bouvier', name: 'Atelier Bouvier Architecture', role: 'Architecte mandataire / MOE' },
  { key: 'coordination-pacifique', name: 'Coordination Pacifique', role: 'OPC' },
  { key: 'pacifique-btp', name: 'Pacifique BTP', role: 'Entreprise générale — Gros œuvre' },
  { key: 'struct-nc', name: 'STRUCT NC', role: 'BET structure' },
  { key: 'fluides-conseil', name: 'Fluides Conseil', role: 'BET fluides' },
  { key: 'e2nc', name: 'E2NC', role: 'BET électricité' },
  { key: 'aluconcept', name: 'AluConcept', role: 'Menuiseries extérieures' },
  { key: 'hydro-nc', name: 'Hydro NC', role: 'Étanchéité' },
  { key: 'jp-peinture', name: 'JP Peinture', role: 'Peinture' },
  { key: 'bureau-control-nc', name: 'Bureau Control NC', role: 'Contrôleur technique' },
  { key: 'sps-pacifique', name: 'SPS Pacifique', role: 'Coordination SPS' },
  { key: 'placo-pacific', name: 'Placo Pacific', role: 'Cloisons / faux plafonds' },
  { key: 'aquatech', name: 'AquaTech', role: 'Plomberie / sanitaires' },
  { key: 'clim-sud', name: 'Clim Sud', role: 'CVC' },
  { key: 'sol-deco', name: 'Sol Déco', role: 'Revêtements de sols' },
  { key: 'terra-nc', name: 'Terra NC', role: 'VRD / extérieurs' },
]
const companyId = (key: string) => duid(`company:${key}`)

type ContactDef = { key: string; companyKey: string; fullName: string; fn: string; internal: boolean }
const CONTACTS: ContactDef[] = [
  { key: 'sophie-martin', companyKey: 'atelier-bouvier', fullName: 'Sophie Martin', fn: 'Architecte projet', internal: true },
  { key: 'lea-menezo', companyKey: 'coordination-pacifique', fullName: 'Léa Ménézo', fn: 'OPC', internal: false },
  { key: 'marc-delmas', companyKey: 'pacifique-btp', fullName: 'Marc Delmas', fn: 'Conducteur de travaux', internal: false },
  { key: 'julien-wamytan', companyKey: 'pacifique-btp', fullName: 'Julien Wamytan', fn: 'Chef de chantier', internal: false },
  { key: 'alain-koteureu', companyKey: 'pacifique-btp', fullName: 'Alain Koteureu', fn: 'Chef de chantier (remplaçant)', internal: false },
  { key: 'thomas-legrand', companyKey: 'struct-nc', fullName: 'Thomas Legrand', fn: 'Ingénieur structure', internal: false },
  { key: 'claire-forest', companyKey: 'fluides-conseil', fullName: 'Claire Forest', fn: 'Ingénieure fluides', internal: false },
  { key: 'eric-nakamura', companyKey: 'e2nc', fullName: 'Éric Nakamura', fn: 'BET électricité', internal: false },
  { key: 'anais-robert', companyKey: 'aluconcept', fullName: 'Anaïs Robert', fn: "Chargée d'affaires menuiseries", internal: false },
  { key: 'thierry-lopes', companyKey: 'hydro-nc', fullName: 'Thierry Lopes', fn: 'Étanchéité', internal: false },
  { key: 'jean-paul-huvon', companyKey: 'jp-peinture', fullName: 'Jean-Paul Huvon', fn: 'Peinture', internal: false },
  { key: 'paul-garcia', companyKey: 'bureau-control-nc', fullName: 'Paul Garcia', fn: 'Contrôleur technique', internal: false },
  { key: 'nicolas-tjibaou', companyKey: 'sps-pacifique', fullName: 'Nicolas Tjibaou', fn: 'Coordonnateur SPS', internal: false },
]
const contactId = (key: string) => duid(`contact:${key}`)

// ── Équipes ───────────────────────────────────────────────────────────────────

const TEAM_MOE_ID = duid('team:moe-koutio')
const TEAM_SUIVI_ID = duid('team:suivi-chantier-koutio')

// ── Sujets canoniques (fils rouges) ────────────────────────────────────────────

const SUBJECTS = {
  b302: duid('subject:b302-terrasse'),
  a204: duid('subject:a204-tableau-electrique'),
  pmr: duid('subject:commerce-rdc-seuil-pmr'),
  facade: duid('subject:facade-a101'),
  fissure: duid('subject:fissure-a301'),
}
const SUBJECT_LABELS: Record<keyof typeof SUBJECTS, string> = {
  b302: 'Terrasse B302 — stagnation / étanchéité',
  a204: 'Appartement A204 — implantation tableau électrique',
  pmr: 'Commerce RDC — seuil PMR',
  facade: 'Façade A101 — prototype menuiseries',
  fissure: 'Fissure allège A301',
}

// Sujets VIVANTS (public.subjects, mig 124) — couche DISTINCTE de canonical_subject
// (mig 279/346, mémoire/identité). site_reports.target_subject_id (mig 162) et
// site_actions.subject_id (mig 124) référencent CETTE table, jamais canonical_subject
// (confirmé par lecture directe des migrations 124/162/279/346). Mêmes clés
// fonctionnelles que SUBJECTS ci-dessus, mais famille d'UUID déterministe séparée
// (duid('live-subject:...') ≠ duid('subject:...')) : aucune collision d'id possible
// entre les deux couches.
const LIVE_SUBJECTS: Record<keyof typeof SUBJECTS, string> = {
  b302: duid('live-subject:b302-terrasse'),
  a204: duid('live-subject:a204-tableau-electrique'),
  pmr: duid('live-subject:commerce-rdc-seuil-pmr'),
  facade: duid('live-subject:facade-a101'),
  fissure: duid('live-subject:fissure-a301'),
}

export { SUBJECTS, LIVE_SUBJECTS }

// ════════════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS (12 site_reports)
// ════════════════════════════════════════════════════════════════════════════════

type Participant = { name: string; role: string; kind: 'person'; presence: 'P' | 'AE' }
function p(name: string, role: string): Participant {
  return { name, role, kind: 'person', presence: 'P' }
}

// Source de vérité : contrainte DB site_reports_visit_motive_check (migration
// 186_visit_motive_intents.sql, qui étend 162_field_visits.sql de façon additive —
// toutes les valeurs historiques sont conservées) ET la constante MOTIVES utilisée
// par le zod schema réel de démarrage/clôture de visite
// (app/(field)/m/site/[siteId]/visit-actions.ts) — les deux définissent exactement
// le même ensemble de 14 valeurs. Toute valeur hors de cette liste serait rejetée
// par le CHECK constraint en base et par le zod schema en usage réel applicatif.
const ALLOWED_VISIT_MOTIVES = [
  'inspection', 'controle', 'reunion', 'avancement', 'reception',
  'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre',
  'premiere', 'previsite_ao', 'prereception', 'sav',
] as const
type VisitMotive = (typeof ALLOWED_VISIT_MOTIVES)[number]

// Source de vérité : migration 162_field_visits.sql — « La visite est une LENTILLE
// (fenêtre temporelle) sur la mémoire du SITE... Marqueur : origin IS NOT NULL
// distingue une visite terrain d'une réunion classique ». Confirmé par le pattern
// production réel dans scripts/demo-capse-seed.ts::seedShowcaseMeetings() : les
// réunions y sont insérées avec origin=NULL (colonne listée mais valeur NULL dans
// le VALUES). Donc ici : les 9 visites terrain portent une origine non-nulle, les
// 3 réunions (report:05/08/12) portent origin=null — jamais 'planned' pour une
// réunion.
type VisitOrigin = 'planned' | 'spontaneous' | 'qr' | 'gps' | null

type EventDef = {
  key: string
  start: string
  end: string
  title: string
  origin: VisitOrigin
  visitMotive: VisitMotive | null
  outcome: string
  resolution?: string
  participants: Participant[]
  summary: string
  decisions: string[]
  targetSubject?: keyof typeof SUBJECTS
}

const EVENTS: EventDef[] = [
  {
    key: 'report:01', start: '2026-04-08T08:00:00+11:00', end: '2026-04-08T10:00:00+11:00',
    title: 'Visite chantier #01 — Gros œuvre / réservations R+2',
    origin: 'planned', visitMotive: 'controle', outcome: 'conforme_reserves',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Marc Delmas', 'Conducteur de travaux'), p('Julien Wamytan', 'Chef de chantier'), p('Claire Forest', 'Ingénieure fluides'), p('Thomas Legrand', 'Ingénieur structure')],
    summary: "Réservation plomberie B203 décalée de 12 cm par rapport au plan. Trémie technique de la cage B trop étroite. Attente électrique du balcon B201 absente. Seuil de la terrasse R+2 à contrôler.",
    decisions: ["Conserver l'implantation de la gaine technique B203 et adapter la cloison du cellier en conséquence."],
  },
  {
    key: 'report:02', start: '2026-04-29T08:00:00+11:00', end: '2026-04-29T10:00:00+11:00',
    title: 'Visite chantier #02 — Prototype façade A101',
    origin: 'planned', visitMotive: 'controle', outcome: 'conforme_reserves',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Marc Delmas', 'Conducteur de travaux'), p('Anaïs Robert', 'Menuiseries extérieures')],
    summary: "Teinte du prototype de façade A101 conforme à la validation. Joints périphériques irréguliers sur plusieurs châssis. Pente d'appui de baie insuffisante côté nord.",
    decisions: ["Prototype de façade A101 accepté sous réserve de reprise des joints et de la pente d'appui avant généralisation aux autres niveaux."],
    targetSubject: 'facade',
  },
  {
    key: 'report:03', start: '2026-05-21T08:00:00+11:00', end: '2026-05-21T09:30:00+11:00',
    title: 'Visite chantier #03 — Terrasse B302',
    origin: 'planned', visitMotive: 'controle', outcome: 'non_conforme', resolution: 'a_suivre',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Marc Delmas', 'Conducteur de travaux'), p('Thierry Lopes', 'Étanchéité')],
    summary: "Stagnation d'eau constatée devant la baie de la terrasse B302 après essai d'arrosage.",
    decisions: [],
    targetSubject: 'b302',
  },
  {
    key: 'report:04', start: '2026-06-18T08:00:00+11:00', end: '2026-06-18T10:00:00+11:00',
    title: 'Visite chantier #04 — Récidive terrasse B302',
    origin: 'planned', visitMotive: 'controle', outcome: 'non_conforme', resolution: 'a_suivre',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Marc Delmas', 'Conducteur de travaux'), p('Thierry Lopes', 'Étanchéité')],
    summary: "Nouvelle stagnation d'eau dans la même zone de la terrasse B302 malgré une reprise déclarée terminée le 27/05.",
    decisions: ["Dépose locale de l'étanchéité, reprise de la chape de forme et nouvelle étanchéité, avec essai d'arrosage de contrôle."],
    targetSubject: 'b302',
  },
  {
    key: 'report:05', start: '2026-07-02T17:00:00+11:00', end: '2026-07-02T18:30:00+11:00',
    title: 'Réunion chantier #12',
    origin: null, visitMotive: null, outcome: 'info',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Mélanie Durand', 'Représentante MOA'), p('Léa Ménézo', 'OPC'), p('Marc Delmas', 'Conducteur de travaux'), p('Anaïs Robert', 'Menuiseries extérieures')],
    summary: "Point planning menuiseries extérieures, choix des revêtements de sol, avancement ascenseur, retard de livraison des menuiseries extérieures.",
    decisions: ["Maintien de l'objectif hors d'eau / hors d'air au 31/07/2026."],
  },
  {
    key: 'report:06', start: '2026-07-16T08:00:00+11:00', end: '2026-07-16T09:30:00+11:00',
    title: 'Visite chantier #05 — Coordination électricité / cuisine A204',
    origin: 'planned', visitMotive: 'controle', outcome: 'non_conforme',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Marc Delmas', 'Conducteur de travaux'), p('Éric Nakamura', 'BET électricité')],
    summary: "Le tableau électrique de l'appartement A204 empiète sur l'emplacement prévu pour la colonne de mobilier de cuisine.",
    decisions: ['Déplacement du tableau électrique A204 de 35 cm vers la circulation.'],
    targetSubject: 'a204',
  },
  {
    key: 'report:07', start: '2026-07-30T08:00:00+11:00', end: '2026-07-30T09:30:00+11:00',
    title: 'Contrôle ciblé — A204 / B302',
    origin: 'planned', visitMotive: 'levee_reserves', outcome: 'conforme_reserves',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Marc Delmas', 'Conducteur de travaux'), p('Éric Nakamura', 'BET électricité'), p('Thierry Lopes', 'Étanchéité')],
    summary: "A204 — déplacement du tableau électrique réalisé et accepté. B302 — contrôle après la deuxième reprise d'étanchéité, aucune stagnation constatée, maintien sous surveillance jusqu'aux OPR.",
    decisions: [],
  },
  {
    key: 'report:08', start: '2026-08-13T17:00:00+11:00', end: '2026-08-13T18:30:00+11:00',
    title: 'Réunion chantier #15',
    origin: null, visitMotive: null, outcome: 'info',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Mélanie Durand', 'Représentante MOA'), p('Léa Ménézo', 'OPC'), p('Marc Delmas', 'Conducteur de travaux')],
    summary: "Point sur les finitions, avancement façade, préparation des opérations préalables à la réception (OPR).",
    decisions: ["Organisation de pré-OPR par cage d'escalier à partir de septembre 2026."],
  },
  {
    key: 'report:09', start: '2026-08-27T08:00:00+11:00', end: '2026-08-27T11:00:00+11:00',
    title: 'Visite chantier #06 — Finitions',
    origin: 'planned', visitMotive: 'inspection', outcome: 'non_conforme',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Marc Delmas', 'Conducteur de travaux'), p('Alain Koteureu', 'Chef de chantier'), p('Jean-Paul Huvon', 'Peinture')],
    summary: "Réserves relevées : peinture cage A niveau 2 (défaut de planéité), trois portes palières rayées, plinthes B104 absentes, appareillage électrique A103 non aligné, silicone salle d'eau B201 à reprendre, seuil PMR du commerce RDC non conforme, grille de ventilation B202 non conforme, joint de dilatation du hall non terminé, poignée de la fenêtre A102 mal fixée.",
    decisions: [],
  },
  {
    key: 'report:10', start: '2026-09-10T08:00:00+11:00', end: '2026-09-10T10:00:00+11:00',
    title: 'Visite chantier #07 — Levée partielle',
    origin: 'planned', visitMotive: 'levee_reserves', outcome: 'conforme_reserves',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Marc Delmas', 'Conducteur de travaux'), p('Alain Koteureu', 'Chef de chantier')],
    summary: "Réserves levées : portes palières remplacées, plinthes B104 posées, grille de ventilation B202 conforme. Peinture cage A niveau 2 partiellement reprise. Seuil PMR du commerce RDC toujours non conforme. Nouveau constat : microfissure sous l'allège de la fenêtre A301.",
    decisions: [],
    targetSubject: 'fissure',
  },
  {
    key: 'report:11', start: '2026-09-24T08:00:00+11:00', end: '2026-09-24T10:30:00+11:00',
    title: 'Visite chantier #08 — Pré-OPR',
    origin: 'planned', visitMotive: 'prereception', outcome: 'conforme_reserves',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Mélanie Durand', 'Représentante MOA'), p('Léa Ménézo', 'OPC'), p('Marc Delmas', 'Conducteur de travaux'), p('Alain Koteureu', 'Chef de chantier'), p('Paul Garcia', 'Contrôleur technique')],
    summary: "Réserves closes : tableau électrique A204, portes palières, plinthes, ventilation B202. Réserves ouvertes : seuil PMR commerce RDC, peinture cage A niveau 2, contrôle final étanchéité B302. Nouvelle action : avis du bureau d'études structure sur la fissure A301 avant réception.",
    decisions: [
      "Référence alternative de carrelage retenue pour le hall en cas de rupture de stock.",
      'Validation définitive de la teinte de façade.',
      'Maintien de la porte technique existante en local poubelles.',
      'Adaptation du seuil PMR du commerce RDC — solution de reprise à valider avec STRUCT NC.',
      'Ajout d’une trappe de visite en faux plafond au R+2.',
    ],
  },
  {
    key: 'report:12', start: '2026-09-30T17:00:00+11:00', end: '2026-09-30T18:30:00+11:00',
    title: 'Réunion chantier #18 — Bilan pré-OPR',
    origin: null, visitMotive: null, outcome: 'info',
    participants: [p('David Bouvier', 'Architecte mandataire'), p('Sophie Martin', 'Architecte projet'), p('Mélanie Durand', 'Représentante MOA'), p('Léa Ménézo', 'OPC'), p('Marc Delmas', 'Conducteur de travaux'), p('Paul Garcia', 'Contrôleur technique')],
    summary: "Bilan de la visite pré-OPR du 24/09. Trois points critiques restent à lever avant réception : seuil PMR commerce RDC, peinture cage A, contrôle final étanchéité terrasse B302.",
    decisions: [
      'OPR de la cage B autorisée sous réserve de la fermeture des trois points critiques identifiés.',
      'Essai d’arrosage complémentaire de la terrasse B302 à programmer avant la date d’OPR.',
    ],
  },
]
const reportId = (key: string) => duid(key)

export { EVENTS, ALLOWED_VISIT_MOTIVES }
export type { VisitMotive, VisitOrigin }

// ════════════════════════════════════════════════════════════════════════════════
// ACTIONS (30)
// ════════════════════════════════════════════════════════════════════════════════

type ActionDef = {
  key: string
  title: string
  corpsEtat: string | null
  assignedTo: string
  assignedCompanyKey?: string
  reportKey: string
  subject?: keyof typeof SUBJECTS
  dueDate: string | null
  status: 'open' | 'done' | 'cancelled'
  doneAt?: string
}

const ACTIONS: ActionDef[] = [
  { key: 'action:1', title: 'Reprendre la pente et l’évacuation de la terrasse B302', corpsEtat: 'Étanchéité', assignedTo: 'Hydro NC — Thierry Lopes', assignedCompanyKey: 'hydro-nc', reportKey: 'report:03', subject: 'b302', dueDate: '2026-05-28', status: 'done', doneAt: '2026-05-27' },
  { key: 'action:2', title: 'Reprise lourde étanchéité terrasse B302 (dépose + chape + nouvelle étanchéité)', corpsEtat: 'Étanchéité', assignedTo: 'Hydro NC — Thierry Lopes', assignedCompanyKey: 'hydro-nc', reportKey: 'report:04', subject: 'b302', dueDate: '2026-07-10', status: 'done', doneAt: '2026-07-29' },
  { key: 'action:3', title: 'Contrôle final étanchéité B302 avant OPR', corpsEtat: 'Étanchéité', assignedTo: 'Hydro NC — Thierry Lopes', assignedCompanyKey: 'hydro-nc', reportKey: 'report:07', subject: 'b302', dueDate: '2026-09-20', status: 'open' },
  { key: 'action:4', title: 'Déplacer le tableau électrique A204 de 35 cm vers la circulation', corpsEtat: 'Électricité', assignedTo: 'E2NC — Éric Nakamura', assignedCompanyKey: 'e2nc', reportKey: 'report:06', subject: 'a204', dueDate: '2026-07-24', status: 'done', doneAt: '2026-07-24' },
  { key: 'action:6', title: 'Reprendre le seuil PMR du commerce RDC', corpsEtat: 'Gros œuvre / accessibilité', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:09', subject: 'pmr', dueDate: '2026-09-05', status: 'open' },
  { key: 'action:7', title: 'Reprendre la peinture cage A niveau 2 (défaut de planéité)', corpsEtat: 'Peinture', assignedTo: 'JP Peinture — Jean-Paul Huvon', assignedCompanyKey: 'jp-peinture', reportKey: 'report:09', dueDate: '2026-09-08', status: 'open' },
  { key: 'action:9', title: 'Demander l’avis de STRUCT NC sur la microfissure sous allège A301', corpsEtat: 'Structure', assignedTo: 'STRUCT NC — Thomas Legrand', assignedCompanyKey: 'struct-nc', reportKey: 'report:11', subject: 'fissure', dueDate: '2026-10-05', status: 'open' },
  { key: 'action:10', title: 'Remplacer 3 portes palières rayées (cage A)', corpsEtat: 'Menuiserie intérieure', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:09', dueDate: '2026-09-08', status: 'done', doneAt: '2026-09-10' },
  { key: 'action:11', title: 'Poser les plinthes manquantes appartement B104', corpsEtat: 'Finitions', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:09', dueDate: '2026-09-08', status: 'done', doneAt: '2026-09-10' },
  { key: 'action:12', title: 'Réaligner l’appareillage électrique appartement A103', corpsEtat: 'Électricité', assignedTo: 'E2NC — Éric Nakamura', assignedCompanyKey: 'e2nc', reportKey: 'report:09', dueDate: '2026-09-15', status: 'done', doneAt: '2026-09-20' },
  { key: 'action:13', title: 'Reprendre le silicone de la salle d’eau B201', corpsEtat: 'Plomberie / sanitaires', assignedTo: 'AquaTech', assignedCompanyKey: 'aquatech', reportKey: 'report:09', dueDate: '2026-09-10', status: 'done', doneAt: '2026-09-10' },
  { key: 'action:14', title: 'Remettre en conformité la grille de ventilation B202', corpsEtat: 'CVC', assignedTo: 'Clim Sud', assignedCompanyKey: 'clim-sud', reportKey: 'report:09', dueDate: '2026-09-08', status: 'done', doneAt: '2026-09-10' },
  { key: 'action:15', title: 'Terminer le joint de dilatation du hall d’entrée', corpsEtat: 'Gros œuvre', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:09', dueDate: '2026-09-15', status: 'done', doneAt: '2026-09-18' },
  { key: 'action:16', title: 'Refixer la poignée de la fenêtre A102', corpsEtat: 'Menuiseries extérieures', assignedTo: 'AluConcept — Anaïs Robert', assignedCompanyKey: 'aluconcept', reportKey: 'report:09', dueDate: '2026-09-08', status: 'done', doneAt: '2026-09-10' },
  { key: 'action:17', title: 'Adapter la cloison du cellier B203 suite au décalage de la gaine plomberie', corpsEtat: 'Gros œuvre', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:01', dueDate: '2026-04-20', status: 'done', doneAt: '2026-04-18' },
  { key: 'action:18', title: 'Élargir la trémie technique de la cage B', corpsEtat: 'Gros œuvre', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:01', dueDate: '2026-04-22', status: 'done', doneAt: '2026-04-21' },
  { key: 'action:19', title: 'Ajouter l’attente électrique manquante balcon B201', corpsEtat: 'Électricité', assignedTo: 'E2NC — Éric Nakamura', assignedCompanyKey: 'e2nc', reportKey: 'report:01', dueDate: '2026-04-25', status: 'done', doneAt: '2026-04-24' },
  { key: 'action:20', title: 'Contrôler l’étanchéité du seuil de la terrasse R+2', corpsEtat: 'Étanchéité', assignedTo: 'Hydro NC — Thierry Lopes', assignedCompanyKey: 'hydro-nc', reportKey: 'report:01', dueDate: '2026-05-05', status: 'done', doneAt: '2026-05-04' },
  { key: 'action:21', title: 'Reprendre les joints périphériques des châssis — prototype façade A101', corpsEtat: 'Menuiseries extérieures', assignedTo: 'AluConcept — Anaïs Robert', assignedCompanyKey: 'aluconcept', reportKey: 'report:02', subject: 'facade', dueDate: '2026-05-10', status: 'done', doneAt: '2026-05-08' },
  { key: 'action:22', title: 'Corriger la pente d’appui de baie — prototype façade A101', corpsEtat: 'Gros œuvre', assignedTo: 'Pacifique BTP — Marc Delmas', assignedCompanyKey: 'pacifique-btp', reportKey: 'report:02', subject: 'facade', dueDate: '2026-05-10', status: 'done', doneAt: '2026-05-09' },
  { key: 'action:23', title: 'Relancer le fournisseur pour le retard de livraison des menuiseries extérieures', corpsEtat: 'Menuiseries extérieures', assignedTo: 'AluConcept — Anaïs Robert', assignedCompanyKey: 'aluconcept', reportKey: 'report:05', dueDate: '2026-07-15', status: 'done', doneAt: '2026-07-14' },
  { key: 'action:24', title: 'Valider le choix définitif des revêtements de sol', corpsEtat: 'Revêtements de sols', assignedTo: 'Sol Déco', assignedCompanyKey: 'sol-deco', reportKey: 'report:05', dueDate: '2026-07-20', status: 'done', doneAt: '2026-07-18' },
  { key: 'action:25', title: 'Point d’avancement ascenseur avec le fournisseur', corpsEtat: 'Divers', assignedTo: 'Mélanie Durand (MOA)', reportKey: 'report:05', dueDate: '2026-08-01', status: 'cancelled' },
  { key: 'action:26', title: 'Préparer le planning des pré-OPR par cage d’escalier', corpsEtat: 'Divers', assignedTo: 'Léa Ménézo (OPC)', assignedCompanyKey: 'coordination-pacifique', reportKey: 'report:08', dueDate: '2026-08-25', status: 'done', doneAt: '2026-08-20' },
  { key: 'action:27', title: 'Finaliser le calepinage façade restant (niveaux R+1 à R+3)', corpsEtat: 'Menuiseries extérieures', assignedTo: 'AluConcept — Anaïs Robert', assignedCompanyKey: 'aluconcept', reportKey: 'report:08', dueDate: '2026-09-01', status: 'done', doneAt: '2026-08-29' },
  { key: 'action:29', title: 'Commander le carrelage de hall en référence alternative (rupture de stock)', corpsEtat: 'Revêtements de sols', assignedTo: 'Sol Déco', assignedCompanyKey: 'sol-deco', reportKey: 'report:11', dueDate: '2026-10-02', status: 'open' },
  { key: 'action:30', title: 'Installer une trappe de visite en faux plafond R+2', corpsEtat: 'Cloisons / faux plafonds', assignedTo: 'Placo Pacific', assignedCompanyKey: 'placo-pacific', reportKey: 'report:11', dueDate: '2026-10-10', status: 'open' },
  { key: 'action:31', title: 'Valider la solution de reprise du seuil PMR avec STRUCT NC', corpsEtat: 'Structure', assignedTo: 'STRUCT NC — Thomas Legrand', assignedCompanyKey: 'struct-nc', reportKey: 'report:11', subject: 'pmr', dueDate: '2026-10-03', status: 'open' },
  { key: 'action:32', title: 'Programmer l’essai d’arrosage complémentaire de la terrasse B302 avant OPR', corpsEtat: 'Étanchéité', assignedTo: 'Hydro NC — Thierry Lopes', assignedCompanyKey: 'hydro-nc', reportKey: 'report:12', subject: 'b302', dueDate: '2026-10-08', status: 'open' },
  { key: 'action:33', title: 'Confirmer la date d’OPR de la cage B avec le bureau de contrôle', corpsEtat: 'Divers', assignedTo: 'Bureau Control NC — Paul Garcia', assignedCompanyKey: 'bureau-control-nc', reportKey: 'report:12', dueDate: '2026-10-06', status: 'open' },
]

export { ACTIONS }

// ════════════════════════════════════════════════════════════════════════════════
// ÉQUIPES — historique réel (team_members pour David, team_field_members sinon)
// ════════════════════════════════════════════════════════════════════════════════

type FieldMembershipDef = { contactKey: string; teamId: string; teamKey: string; joinedAt: string; leftAt: string | null }
const FIELD_MEMBERSHIPS: FieldMembershipDef[] = [
  { contactKey: 'sophie-martin', teamId: TEAM_MOE_ID, teamKey: 'moe-koutio', joinedAt: '2026-02-10', leftAt: null },
  { contactKey: 'lea-menezo', teamId: TEAM_MOE_ID, teamKey: 'moe-koutio', joinedAt: '2026-03-05', leftAt: null },
  { contactKey: 'marc-delmas', teamId: TEAM_SUIVI_ID, teamKey: 'suivi-chantier-koutio', joinedAt: '2026-03-01', leftAt: null },
  { contactKey: 'julien-wamytan', teamId: TEAM_SUIVI_ID, teamKey: 'suivi-chantier-koutio', joinedAt: '2026-03-01', leftAt: '2026-08-28' },
  { contactKey: 'alain-koteureu', teamId: TEAM_SUIVI_ID, teamKey: 'suivi-chantier-koutio', joinedAt: '2026-08-25', leftAt: null },
]

// ════════════════════════════════════════════════════════════════════════════════
// GARDE-FOUS D'EXÉCUTION (lecture seule, exécutés même en --dry-run)
// ════════════════════════════════════════════════════════════════════════════════

async function verifyGuardrails(): Promise<string[]> {
  const notes: string[] = []

  const davidRows = (await runSql(`SELECT id, email FROM auth.users WHERE id = '${DAVID_ID}'`)) as Array<{ id: string; email: string }>
  if (davidRows.length !== 1 || davidRows[0].email !== DAVID_EMAIL) {
    throw new Error(`GUARDRAIL: David Bouvier introuvable ou email différent — attendu ${DAVID_EMAIL}, trouvé ${JSON.stringify(davidRows)}`)
  }
  notes.push(`OK — David Bouvier confirmé (${DAVID_ID}, ${DAVID_EMAIL})`)

  const existing = (await runSql(
    `SELECT id, name FROM public.organizations WHERE demo_seed_key = '${SEED_KEY}'`,
  )) as Array<{ id: string; name: string }>
  if (existing.length > 1 || (existing.length === 1 && existing[0].id !== ORG_ID)) {
    throw new Error(`GUARDRAIL: demo_seed_key '${SEED_KEY}' déjà porté par une autre organisation que celle calculée: ${JSON.stringify(existing)} vs attendu ${ORG_ID}`)
  }
  notes.push(
    existing.length === 0
      ? `OK — aucune organisation n'utilise encore demo_seed_key='${SEED_KEY}' (première exécution)`
      : `OK — organisation déjà existante avec demo_seed_key='${SEED_KEY}' (ré-exécution idempotente), id=${existing[0].id}`,
  )

  const protectedIds = Object.keys(PROTECTED_ORGS)
  const protectedRows = (await runSql(
    `SELECT id, name FROM public.organizations WHERE id IN (${protectedIds.map((id) => `'${id}'`).join(',')})`,
  )) as Array<{ id: string; name: string }>
  for (const id of protectedIds) {
    const row = protectedRows.find((r) => r.id === id)
    if (!row || row.name !== PROTECTED_ORGS[id]) {
      throw new Error(`GUARDRAIL: organisation protégée ${id} introuvable ou renommée — attendu "${PROTECTED_ORGS[id]}", trouvé ${JSON.stringify(row)}`)
    }
  }
  notes.push(`OK — les 3 organisations protégées sont présentes et nommées comme attendu (${protectedIds.join(', ')})`)

  assertSafeOrgId(ORG_ID, 'post-check ORG_ID')
  notes.push(`OK — ORG_ID calculé (${ORG_ID}) n'est pas dans la liste protégée`)

  return notes
}

// ════════════════════════════════════════════════════════════════════════════════
// PLAN (dry-run)
// ════════════════════════════════════════════════════════════════════════════════

export function buildPlanSummary(): string[] {
  const lines: string[] = []
  lines.push(`TARGET USER       : ${DAVID_EMAIL} (${DAVID_ID})`)
  lines.push(`TARGET ORGANIZATION: Atelier Bouvier — Démonstration (${ORG_ID})`)
  lines.push(`SEED KEY          : ${SEED_KEY}`)
  lines.push('')
  lines.push(`Organisations à créer/mettre à jour : 1 (${ORG_ID})`)
  lines.push(`Memberships                          : 1 (David, admin)`)
  lines.push(`Client (MOA)                          : 1 (${CLIENT_ID})`)
  lines.push(`Chantier                              : 1 (${SITE_ID})`)
  lines.push(`Sociétés (companies)                 : ${COMPANIES.length}`)
  lines.push(`Contacts (company_contacts)          : ${CONTACTS.length}`)
  lines.push(`Intervenants chantier (site_intervenants): ${COMPANIES.length}`)
  lines.push(`Équipes                               : 2 (MOE Koutio Horizon, Suivi chantier Koutio)`)
  lines.push(`  team_members (comptes connectés)    : 1 (David)`)
  lines.push(`  team_field_members (contacts terrain): ${FIELD_MEMBERSHIPS.length}`)
  lines.push(`Sujets canoniques (fils rouges)       : ${Object.keys(SUBJECTS).length}`)
  lines.push(`Sujets vivants (public.subjects)      : ${Object.keys(LIVE_SUBJECTS).length}`)
  lines.push(`Événements (site_reports)             : ${EVENTS.length}`)
  const meetingCount = EVENTS.filter((e) => e.origin === null).length
  lines.push(`  dont réunions (origin=NULL)=${meetingCount}, visites terrain (origin renseigné)=${EVENTS.length - meetingCount}`)
  lines.push(`Actions (site_actions)                : ${ACTIONS.length}`)
  const doneCount = ACTIONS.filter((a) => a.status === 'done').length
  const openCount = ACTIONS.filter((a) => a.status === 'open').length
  const lateCount = ACTIONS.filter((a) => a.status === 'open' && a.dueDate && a.dueDate < TODAY_STR).length
  const cancelledCount = ACTIONS.filter((a) => a.status === 'cancelled').length
  lines.push(`  dont done=${doneCount}, open=${openCount} (en retard=${lateCount}), cancelled=${cancelledCount}`)
  lines.push('')
  lines.push('Photos / documents / storage : AUCUN (interdit en Phase B1).')
  return lines
}

// ════════════════════════════════════════════════════════════════════════════════
// SEED — écriture réelle
// ════════════════════════════════════════════════════════════════════════════════

async function seedOrg() {
  assertSafeOrgId(ORG_ID, 'seedOrg')
  await runSql(`
    INSERT INTO public.organizations (id, name, slug, is_demo, demo_seed_key)
    VALUES ('${ORG_ID}', 'Atelier Bouvier — Démonstration', 'atelier-bouvier-demo', true, '${SEED_KEY}')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, is_demo = true, demo_seed_key = EXCLUDED.demo_seed_key
  `)
}

async function seedMembership() {
  await runSql(`
    INSERT INTO public.organization_memberships (id, user_id, organization_id, role, status)
    VALUES ('${MEMBERSHIP_DAVID_ID}', '${DAVID_ID}', '${ORG_ID}', 'admin'::user_role, 'active')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
  `)
}

async function seedClientAndSite() {
  await runSql(`
    INSERT INTO public.clients (id, name, contact_name, organization_id)
    VALUES ('${CLIENT_ID}', 'SCI Koutio Horizon', 'Mélanie Durand', '${ORG_ID}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, contact_name = EXCLUDED.contact_name, organization_id = EXCLUDED.organization_id
  `)

  const notes =
    "Construction d'un immeuble R+3 comprenant 18 logements, 2 locaux commerciaux et 32 places de stationnement couvertes. " +
    'Contexte : second œuvre / finitions / préparation OPR. ' +
    'Début de chantier : février 2026. Livraison prévisionnelle : décembre 2026. Budget indicatif : 420 M F CFP.'

  await runSql(`
    INSERT INTO public.sites (id, client_id, name, address, notes, organization_id, phase)
    VALUES ('${SITE_ID}', '${CLIENT_ID}', 'Résidence Koutio Horizon', 'Koutio, Dumbéa, Nouvelle-Calédonie', ${esc(notes)}, '${ORG_ID}', 'actif')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, address = EXCLUDED.address, notes = EXCLUDED.notes,
      organization_id = EXCLUDED.organization_id, phase = EXCLUDED.phase
  `)
}

async function seedCompaniesAndContacts() {
  const companyRows = COMPANIES.map(
    (c) => `('${companyId(c.key)}', '${ORG_ID}', ${esc(c.name)})`,
  ).join(',\n    ')
  await runSql(`
    INSERT INTO public.companies (id, organization_id, name)
    VALUES
    ${companyRows}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, organization_id = EXCLUDED.organization_id
  `)

  const contactRows = CONTACTS.map(
    (c) =>
      `('${contactId(c.key)}', '${companyId(c.companyKey)}', ${esc(c.fullName)}, ${esc(c.fn)}, ${c.internal}, '${ORG_ID}')`,
  ).join(',\n    ')
  await runSql(`
    INSERT INTO public.company_contacts (id, company_id, full_name, function, is_internal_agent, organization_id)
    VALUES
    ${contactRows}
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, function = EXCLUDED.function, is_internal_agent = EXCLUDED.is_internal_agent
  `)
}

async function seedSiteIntervenants() {
  const rows = COMPANIES.map((c) => {
    const mainContact = CONTACTS.find((ct) => ct.companyKey === c.key)
    return `('${duid(`intervenant:${c.key}`)}', '${SITE_ID}', ${esc(c.role)}, '${companyId(c.key)}', ${escUuid(mainContact ? contactId(mainContact.key) : null)}, '2026-02-10', '${ORG_ID}')`
  }).join(',\n    ')
  await runSql(`
    INSERT INTO public.site_intervenants (id, site_id, role, company_id, main_contact_id, effective_from, organization_id)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, main_contact_id = EXCLUDED.main_contact_id
  `)
}

async function seedTeams() {
  await runSql(`
    INSERT INTO public.teams (id, name, active, organization_id, created_by)
    VALUES
      ('${TEAM_MOE_ID}', 'MOE Koutio Horizon', true, '${ORG_ID}', '${DAVID_ID}'),
      ('${TEAM_SUIVI_ID}', 'Suivi chantier Koutio', true, '${ORG_ID}', '${DAVID_ID}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, organization_id = EXCLUDED.organization_id
  `)

  await runSql(`
    INSERT INTO public.team_members (id, team_id, user_id, joined_at, organization_id)
    VALUES ('${duid('team_member:david:moe-koutio')}', '${TEAM_MOE_ID}', '${DAVID_ID}', '2026-02-10T00:00:00+11:00', '${ORG_ID}')
    ON CONFLICT (id) DO NOTHING
  `)

  const rows = FIELD_MEMBERSHIPS.map((m) => {
    const key = `tfm:${m.contactKey}:${m.teamKey}`
    return `('${duid(key)}', '${ORG_ID}', '${m.teamId}', '${contactId(m.contactKey)}', '${m.joinedAt}T00:00:00+11:00', ${m.leftAt ? `'${m.leftAt}T00:00:00+11:00'` : 'NULL'}, '${DAVID_ID}')`
  }).join(',\n    ')
  await runSql(`
    INSERT INTO public.team_field_members (id, organization_id, team_id, contact_id, joined_at, left_at, created_by)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET left_at = EXCLUDED.left_at
  `)
}

async function seedCanonicalSubjects() {
  const rows = (Object.keys(SUBJECTS) as Array<keyof typeof SUBJECTS>)
    .map((k) => `('${SUBJECTS[k]}', '${SITE_ID}', ${esc(SUBJECT_LABELS[k])}, 'business_subject')`)
    .join(',\n    ')
  await runSql(`
    INSERT INTO public.canonical_subject (id, site_id, label, kind)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label
  `)
}

// public.subjects (mig 124) — couche VIVANTE distincte de canonical_subject. C'est
// CETTE table que site_reports.target_subject_id et site_actions.subject_id
// référencent réellement (cf. lib/db/subjects.ts — listSubjectsBySite/getSubjectThread
// lisent site_actions.subject_id, jamais canonical_subject_id).
async function seedLiveSubjects() {
  const rows = (Object.keys(LIVE_SUBJECTS) as Array<keyof typeof LIVE_SUBJECTS>)
    .map((k) => `('${LIVE_SUBJECTS[k]}', '${ORG_ID}', '${SITE_ID}', ${esc(SUBJECT_LABELS[k])}, 'open', '${DAVID_ID}')`)
    .join(',\n    ')
  await runSql(`
    INSERT INTO public.subjects (id, organization_id, site_id, name, status, created_by)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `)
}

function buildDebriefAnalysis(ev: EventDef) {
  return {
    summary: ev.summary,
    decisions: ev.decisions,
    actions: [],
    watchpoints: [],
    a_savoir: [],
    echeances: [],
    intervenants: ev.participants.filter((pp) => pp.presence === 'P').map((pp) => pp.name),
    attention: [],
    open_questions: [],
    forgotten_obligations: [],
    objective: ev.title,
    objective_rationale: 'Suivi de chantier Résidence Koutio Horizon.',
    objective_confidence: 'elevee',
    subject_match_index: -1,
    subject_name: '',
    subject_rationale: '',
    subject_confidence: null,
    outcome: ev.outcome,
    resolution: ev.resolution ?? null,
    provider: 'manual-seed',
    model: 'demo-architect-koutio-seed',
    generated_at: ev.start,
    corpus_hash: null,
    schema_version: 'v7-echeances-ancrees',
    analysis_version: 1,
    source_snapshot: { photos: 0, videos: 0, vocals: 0, notes: 0, last_capture_at: null },
    action_ledger: [],
  }
}

async function seedEvents() {
  const rows = EVENTS.map((ev) => {
    const debrief = buildDebriefAnalysis(ev)
    // target_subject_id référence public.subjects (couche vivante), pas
    // canonical_subject (mig 162 : site_reports.target_subject_id → public.subjects).
    const targetSubjectId = ev.targetSubject ? LIVE_SUBJECTS[ev.targetSubject] : null
    return `(
      '${reportId(ev.key)}', '${SITE_ID}', '${ORG_ID}', '${ORG_ID}',
      'curated', 'none', ${ev.origin ? esc(ev.origin) : 'NULL'},
      ${esc(pgTs(new Date(ev.start)))}, ${esc(pgTs(new Date(ev.end)))},
      ${esc(ev.title)}, ${esc(ev.visitMotive)}, ${esc(ev.title)}, ${esc(ev.outcome)},
      ${ev.resolution ? esc(ev.resolution) : 'NULL'},
      ${escUuid(targetSubjectId)},
      ${escJson(debrief)},
      ${escJson(ev.participants)},
      '${DAVID_ID}', ${esc(pgTs(new Date(ev.start)))}
    )`
  }).join(',\n    ')

  await runSql(`
    INSERT INTO public.site_reports
      (id, site_id, organization_id, tenant_id,
       status, transcript_status, origin,
       started_at, ended_at,
       title, visit_motive, objective, outcome,
       resolution, target_subject_id,
       debrief_analysis, participants,
       created_by, created_at)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, outcome = EXCLUDED.outcome, resolution = EXCLUDED.resolution,
      debrief_analysis = EXCLUDED.debrief_analysis, participants = EXCLUDED.participants
  `)
}

async function seedActions() {
  const rows = ACTIONS.map((a) => {
    // Double rattachement volontaire : canonical_subject_id (mémoire/identité,
    // mig 346) ET subject_id (fil vivant consulté par le produit réel, mig 124 —
    // cf. lib/db/subjects.ts). Deux UUID distincts, deux couches distinctes.
    const canonicalSubjectId = a.subject ? SUBJECTS[a.subject] : null
    const liveSubjectId = a.subject ? LIVE_SUBJECTS[a.subject] : null
    const companyIdVal = a.assignedCompanyKey ? companyId(a.assignedCompanyKey) : null
    return `(
      '${duid(a.key)}', '${SITE_ID}', '${reportId(a.reportKey)}', ${esc(a.title)},
      ${a.corpsEtat ? esc(a.corpsEtat) : 'NULL'}, ${esc(a.assignedTo)}, '${a.status}',
      ${a.dueDate ? `'${a.dueDate}'` : 'NULL'}, ${a.dueDate ? esc('explicit') : 'NULL'},
      ${a.doneAt ? esc(pgTs(new Date(`${a.doneAt}T12:00:00+11:00`))) : 'NULL'},
      '${DAVID_ID}', '${ORG_ID}', ${escUuid(companyIdVal)}, ${escUuid(canonicalSubjectId)}, ${escUuid(liveSubjectId)}
    )`
  }).join(',\n    ')

  await runSql(`
    INSERT INTO public.site_actions
      (id, site_id, report_id, title, corps_etat, assigned_to, status,
       due_date, due_date_status, done_at,
       created_by, organization_id, assigned_company_id, canonical_subject_id, subject_id)
    VALUES
    ${rows}
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status, due_date = EXCLUDED.due_date, done_at = EXCLUDED.done_at
  `)
}

async function seed() {
  console.log('\n🌱 Seed démo architecte — Koutio Horizon\n')
  console.log(`Org ID : ${ORG_ID}`)
  console.log(`Supabase : ${SUPABASE_URL}\n`)

  const guardrailNotes = await verifyGuardrails()
  guardrailNotes.forEach((n) => console.log('  ' + n))

  await seedOrg()
  await seedMembership()
  await seedClientAndSite()
  await seedCompaniesAndContacts()
  await seedSiteIntervenants()
  await seedTeams()
  await seedCanonicalSubjects()
  await seedLiveSubjects()
  await seedEvents()
  await seedActions()

  console.log('\n✅ Seed Koutio Horizon terminé.')
  buildPlanSummary().forEach((l) => console.log('  ' + l))
}

// ════════════════════════════════════════════════════════════════════════════════
// ROLLBACK — dry-run (comptage) et réel (suppression fail-closed)
//
// Ordre des tables conforme aux FK : enfants avant parents (actions avant reports
// avant canonical_subject/subjects — ordre entre ces deux derniers non contraignant,
// les deux FK depuis actions/reports sont on delete set null ; team_field_members/
// team_members avant teams ; site_intervenants avant company_contacts avant
// companies ; sites avant clients ; organization_memberships avant organizations).
// Ne jamais réordonner sans revérifier les contraintes de clé étrangère réelles en base.
// ════════════════════════════════════════════════════════════════════════════════

const ROLLBACK_TABLES: Array<{ table: string; where: string }> = [
  { table: 'public.site_actions', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.site_reports', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.canonical_subject', where: `site_id = '${SITE_ID}'` },
  { table: 'public.subjects', where: `site_id = '${SITE_ID}'` },
  { table: 'public.team_field_members', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.team_members', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.teams', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.site_intervenants', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.company_contacts', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.companies', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.sites', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.clients', where: `organization_id = '${ORG_ID}'` },
  // Scopé exclusivement par organization_id (jamais par user_id) : ne supprime que
  // le membership de David dans CETTE organisation démo, jamais ses autres memberships.
  { table: 'public.organization_memberships', where: `organization_id = '${ORG_ID}'` },
  { table: 'public.organizations', where: `id = '${ORG_ID}'` },
]

type RollbackOrgRow = { id: string; name?: string; is_demo: boolean | null; demo_seed_key: string | null }

// Garde-fou pur (sans I/O) — testable isolément. Lève si l'organisation trouvée
// n'est pas STRICTEMENT celle attendue : mauvais id, protégée, is_demo != true,
// ou demo_seed_key différent de la seed_key courante. Fail-closed : en cas de doute,
// on refuse plutôt que de supprimer.
function assertRollbackEligible(org: RollbackOrgRow): void {
  if (org.id !== ORG_ID) {
    throw new Error(
      `GUARDRAIL ROLLBACK: organization.id (${org.id}) ne correspond pas à l'UUID déterministe attendu (${ORG_ID}) — refus de suppression`,
    )
  }
  if (PROTECTED_ORGS[org.id]) {
    throw new Error(
      `GUARDRAIL ROLLBACK: organisation protégée "${PROTECTED_ORGS[org.id]}" (${org.id}) — refus de suppression`,
    )
  }
  if (org.demo_seed_key !== SEED_KEY) {
    throw new Error(
      `GUARDRAIL ROLLBACK: demo_seed_key invalide (attendu '${SEED_KEY}', trouvé ${JSON.stringify(org.demo_seed_key)}) — refus de suppression`,
    )
  }
  if (org.is_demo !== true) {
    throw new Error(
      `GUARDRAIL ROLLBACK: is_demo doit être true (trouvé ${JSON.stringify(org.is_demo)}) — refus de suppression`,
    )
  }
}

async function fetchRollbackTargetOrg(): Promise<RollbackOrgRow | null> {
  const rows = (await runSql(
    `SELECT id, name, is_demo, demo_seed_key FROM public.organizations WHERE id = '${ORG_ID}'`,
  )) as RollbackOrgRow[]
  return rows.length === 0 ? null : rows[0]
}

async function rollbackDryRun() {
  assertSafeOrgId(ORG_ID, 'rollbackDryRun')
  console.log(`\n🔎 Rollback --dry-run — Koutio Horizon (${ORG_ID})\n`)
  for (const t of ROLLBACK_TABLES) {
    assertOrgIdPresent(ORG_ID, `rollbackDryRun:${t.table}`)
    const rows = (await runSql(`SELECT count(*)::int AS n FROM ${t.table} WHERE ${t.where}`)) as Array<{ n: number }>
    console.log(`  ${t.table.padEnd(36)} : ${rows[0]?.n ?? 0} ligne(s) seraient supprimées (WHERE ${t.where})`)
  }
  console.log('\nAucune suppression exécutée (mode --rollback --dry-run).')
}

// Rollback réel — fail-closed. N'agit que si l'organisation existe ET passe
// assertRollbackEligible. Si l'organisation est absente, no-op explicite (rien à
// supprimer), ce n'est pas une erreur.
async function rollbackReal() {
  assertSafeOrgId(ORG_ID, 'rollbackReal')
  console.log(`\n🗑️  ROLLBACK RÉEL — Koutio Horizon (${ORG_ID})\n`)

  const org = await fetchRollbackTargetOrg()
  if (!org) {
    console.log(`  OK — organisation ${ORG_ID} introuvable, rien à supprimer (no-op).`)
    return
  }

  assertRollbackEligible(org)
  console.log(`  OK — organisation "${org.name}" (${org.id}) éligible au rollback (is_demo=true, demo_seed_key='${SEED_KEY}')`)

  for (const t of ROLLBACK_TABLES) {
    assertOrgIdPresent(ORG_ID, `rollbackReal:${t.table}`)
    const rows = (await runSql(`DELETE FROM ${t.table} WHERE ${t.where} RETURNING 1 AS deleted`)) as unknown[]
    console.log(`  ${t.table.padEnd(36)} : ${rows.length} ligne(s) supprimée(s)`)
  }

  console.log('\n✅ Rollback réel terminé.')
}

export { ROLLBACK_TABLES, assertRollbackEligible }

// ════════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isRollback = args.includes('--rollback')

  if (isRollback && isDryRun) {
    await rollbackDryRun()
    return
  }

  if (isRollback && !isDryRun) {
    await rollbackReal()
    return
  }

  if (isDryRun) {
    console.log('\n🔎 DRY-RUN — Koutio Horizon (aucune écriture)\n')
    const guardrailNotes = await verifyGuardrails()
    guardrailNotes.forEach((n) => console.log('  ' + n))
    console.log('\nPlan :')
    buildPlanSummary().forEach((l) => console.log('  ' + l))
    console.log('\nAucune écriture exécutée (mode --dry-run).')
    return
  }

  await seed()
}

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
if (isMainModule) {
  main().catch((e) => {
    console.error('\n❌', e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
