#!/usr/bin/env npx tsx
/**
 * Seed de démonstration CAPSE — idempotent, réexécutable.
 * Usage : npx tsx scripts/demo-capse-seed.ts
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as https from 'node:https'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!
const PROJECT_REF = 'srixnofmaydxouhucawn'
const SEED_KEY = 'capse-2026-v1'
const PASSWORD = 'Memoria2026!'
const TODAY_STR = '2026-07-29'

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
  const res = await httpPost(
    'api.supabase.com',
    `/v1/projects/${PROJECT_REF}/database/query`,
    { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    JSON.stringify({ query }),
  )
  if (res.status >= 400) {
    throw new Error(`SQL ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}`)
  }
  return res.data as unknown[]
}

async function createAuthUser(email: string, fullName: string): Promise<string> {
  // Supabase Admin API — works with service role key
  const supabaseHost = new URL(SUPABASE_URL).hostname
  const res = await httpPost(
    supabaseHost,
    '/auth/v1/admin/users',
    {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }),
  )
  if (res.status === 200 || res.status === 201) {
    return (res.data as { id: string }).id
  }
  // Already exists (422) — fetch by email via Management API SQL
  if (res.status === 422 || res.status === 409) {
    const rows = await runSql(`SELECT id FROM auth.users WHERE email = '${email}' LIMIT 1`)
    if (Array.isArray(rows) && rows.length) return (rows[0] as { id: string }).id
  }
  throw new Error(`Cannot create or find auth user ${email}: ${res.status} ${JSON.stringify(res.data)}`)
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function addDays(base: string, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}
function pgTs(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00')
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Deterministic pick ─────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[], seed: string): T {
  const b = crypto.createHash('sha256').update(seed).digest()
  return arr[b[0] % arr.length]
}
function pickN<T>(arr: readonly T[], n: number, seed: string): T[] {
  return Array.from({ length: n }, (_, i) => pick(arr, `${seed}:${i}`))
}

// ── SQL escaping ───────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (s == null) return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}
function escJson(obj: unknown): string {
  return esc(JSON.stringify(obj))
}

// ════════════════════════════════════════════════════════════════════════════════
// DONNÉES STATIQUES
// ════════════════════════════════════════════════════════════════════════════════

const ORG_ID = duid('org:capse')

const USERS = [
  { key: 'david.bouvier', email: 'david.bouvier.test@memoria.nc', name: 'David Bouvier', role: 'admin', homePreference: 'dashboard' },
  { key: 'marie.lefevre', email: 'marie.lefevre.test@memoria.nc', name: 'Marie Lefèvre', role: 'manager', homePreference: 'dashboard' },
  { key: 'jp.kaemo', email: 'jp.kaemo.test@memoria.nc', name: 'Jean-Pierre Kaémo', role: 'chef_equipe', homePreference: 'terrain' },
  { key: 'sophie.wane', email: 'sophie.wane.test@memoria.nc', name: 'Sophie Wané', role: 'chef_equipe', homePreference: 'terrain' },
  { key: 'patrick.djiril', email: 'patrick.djiril.test@memoria.nc', name: 'Patrick Djirilet', role: 'chef_equipe', homePreference: 'terrain' },
] as const

const CLIENTS = [
  { key: 'pacific-industries', name: 'Pacific Industries SA', address: 'Zone industrielle Ducos, Nouméa', phone: '+687 24 31 50' },
  { key: 'hilton-noumea', name: 'Hôtel Hilton Nouméa', address: '2 Promenade Roger Laroque, Nouméa', phone: '+687 26 90 00' },
  { key: 'dumbea-mall', name: 'Dumbéa Mall', address: 'Route de Tontouta, Dumbéa', phone: '+687 41 19 20' },
  { key: 'ville-dumbea', name: 'Commune de Dumbéa', address: '1 Place de la Mairie, Dumbéa', phone: '+687 41 80 00' },
  { key: 'lycee-garnier', name: 'Lycée Jules Garnier', address: '12 Rue Auvergne, Nouméa', phone: '+687 28 41 00' },
  { key: 'smsp-tower', name: 'SMSP Tower', address: '1 Place des Cocotiers, Nouméa', phone: '+687 23 65 00' },
  { key: 'port-nc', name: 'Port Autonome de Nouvelle-Calédonie', address: 'Quai Ferry, Nouméa', phone: '+687 24 27 00' },
  { key: 'totalenergies-nc', name: 'TotalÉnergies NC', address: 'Station Montravel, Nouméa', phone: '+687 28 55 10' },
  { key: 'ballande-logistique', name: 'Ballande Logistique', address: 'Zone de Ducos, Nouméa', phone: '+687 24 80 30' },
  { key: 'clinique-kuindo', name: 'Clinique Kuindo-Magnin', address: 'Artillerie, Nouméa', phone: '+687 26 68 00' },
  { key: 'vale-nc', name: 'Vale NC', address: 'Usine de Goro, Province Sud', phone: '+687 43 80 00' },
  { key: 'casino-noumea', name: 'Casino de Nouméa', address: 'Anse Vata, Nouméa', phone: '+687 26 25 00' },
  { key: 'cps-nc', name: 'CPS – Caisse de Protection Sociale', address: 'Quartier Latin, Nouméa', phone: '+687 25 18 00' },
  { key: 'prony-resources', name: 'Prony Resources', address: 'Site de Prony, Province Sud', phone: '+687 43 60 00' },
  { key: 'aircalin', name: 'Aircalin', address: 'Aéroport de La Tontouta', phone: '+687 26 55 00' },
] as const

const SITES = [
  { key: 'pacific-doniambo', clientKey: 'pacific-industries', name: 'Usine Doniambo', address: 'Zone industrielle Ducos, Bâtiment A, Nouméa' },
  { key: 'pacific-hangar', clientKey: 'pacific-industries', name: 'Hangar de stockage', address: 'Zone industrielle Ducos, Bâtiment C, Nouméa' },
  { key: 'pacific-labo', clientKey: 'pacific-industries', name: 'Laboratoire qualité', address: 'Zone industrielle Ducos, Bâtiment D, Nouméa' },
  { key: 'hilton-rdc', clientKey: 'hilton-noumea', name: 'Rez-de-chaussée et lobby', address: 'Promenade R. Laroque — RDC, Nouméa' },
  { key: 'hilton-technique', clientKey: 'hilton-noumea', name: 'Sous-sol technique', address: 'Promenade R. Laroque — Sous-sol, Nouméa' },
  { key: 'hilton-piscine', clientKey: 'hilton-noumea', name: 'Espace piscine & pool bar', address: 'Promenade R. Laroque — Terrasse, Nouméa' },
  { key: 'dumbea-galerie', clientKey: 'dumbea-mall', name: 'Galerie principale', address: 'Dumbéa Mall, Niveau 1' },
  { key: 'dumbea-parking', clientKey: 'dumbea-mall', name: 'Parking souterrain', address: 'Dumbéa Mall, Niveau −1' },
  { key: 'dumbea-local-tech', clientKey: 'dumbea-mall', name: 'Local technique centralisé', address: 'Dumbéa Mall, Niveau −2' },
  { key: 'dumbea-mairie', clientKey: 'ville-dumbea', name: 'Mairie principale', address: '1 Place de la Mairie, Dumbéa' },
  { key: 'dumbea-sport', clientKey: 'ville-dumbea', name: 'Centre sportif municipal', address: 'Rue des Sports, Dumbéa' },
  { key: 'garnier-principal', clientKey: 'lycee-garnier', name: 'Bâtiment principal', address: 'Lycée Jules Garnier, Bât. A' },
  { key: 'garnier-internat', clientKey: 'lycee-garnier', name: 'Internat', address: 'Lycée Jules Garnier, Bât. B' },
  { key: 'garnier-cuisine', clientKey: 'lycee-garnier', name: 'Cuisine centrale', address: 'Lycée Jules Garnier, Bât. C' },
  { key: 'smsp-plateau3', clientKey: 'smsp-tower', name: 'Plateau 3e étage', address: 'SMSP Tower, 3e étage, Nouméa' },
  { key: 'smsp-plateau8', clientKey: 'smsp-tower', name: 'Plateau 8e étage', address: 'SMSP Tower, 8e étage, Nouméa' },
  { key: 'port-terminal', clientKey: 'port-nc', name: 'Terminal à conteneurs', address: 'Port Autonome, Terminal 2, Nouméa' },
  { key: 'port-frigo', clientKey: 'port-nc', name: 'Entrepôt frigorifique', address: 'Port Autonome, Quai 5, Nouméa' },
  { key: 'total-montravel', clientKey: 'totalenergies-nc', name: 'Station Montravel', address: 'Route de Montravel, Nouméa' },
  { key: 'total-dumbea', clientKey: 'totalenergies-nc', name: 'Station Dumbéa Est', address: 'Route de Ouémo, Dumbéa' },
  { key: 'ballande-entrepot-a', clientKey: 'ballande-logistique', name: 'Entrepôt A', address: 'Zone Ducos, Entrepôt A, Nouméa' },
  { key: 'ballande-entrepot-b', clientKey: 'ballande-logistique', name: 'Entrepôt B', address: 'Zone Ducos, Entrepôt B, Nouméa' },
  { key: 'kuindo-bloc', clientKey: 'clinique-kuindo', name: 'Bloc opératoire', address: 'Clinique Kuindo, Bât. médical, Artillerie' },
  { key: 'kuindo-urgences', clientKey: 'clinique-kuindo', name: "Service urgences", address: 'Clinique Kuindo, Entrée urgences' },
  { key: 'vale-fonderie', clientKey: 'vale-nc', name: 'Fonderie', address: 'Site de Goro — Zone fonderie' },
  { key: 'vale-traitement', clientKey: 'vale-nc', name: 'Station de traitement des eaux', address: 'Site de Goro — Zone environnement' },
  { key: 'casino-jeux', clientKey: 'casino-noumea', name: 'Salle des jeux', address: 'Casino Nouméa, RDC, Anse Vata' },
  { key: 'casino-machines', clientKey: 'casino-noumea', name: 'Local machines & sous-stations', address: 'Casino Nouméa, Sous-sol' },
  { key: 'cps-siege', clientKey: 'cps-nc', name: 'Siège social', address: 'Quartier Latin, Nouméa' },
  { key: 'cps-dumbea', clientKey: 'cps-nc', name: 'Antenne Dumbéa', address: 'Centre Dumbéa, Route de Tontouta' },
  { key: 'prony-mine', clientKey: 'prony-resources', name: 'Site minier Prony', address: 'Prony — Zone extraction' },
  { key: 'prony-usine', clientKey: 'prony-resources', name: 'Usine de traitement', address: 'Prony — Zone traitement' },
  { key: 'aircalin-maintenance', clientKey: 'aircalin', name: 'Hangar maintenance', address: 'Aéroport Tontouta, Zone technique' },
  { key: 'aircalin-bureaux', clientKey: 'aircalin', name: 'Bureaux Tontouta', address: 'Aéroport Tontouta, Terminal' },
] as const

const PEOPLE_ENTITIES = [
  { key: 'ent:marc-rodriguez', label: 'Marc Rodriguez', type: 'person', aliases: ['Marc', 'Rodriguez', 'Marc R.'] },
  { key: 'ent:fatima-ouali', label: 'Fatima Ouali', type: 'person', aliases: ['Fatima', 'Mme Ouali'] },
  { key: 'ent:luc-barnard', label: 'Luc Barnard', type: 'person', aliases: ['Luc', 'Barnard'] },
  { key: 'ent:claire-tetuanui', label: 'Claire Tétuanui', type: 'person', aliases: ['Claire', 'Mme Tétuanui'] },
  { key: 'ent:olivier-meunier', label: 'Olivier Meunier', type: 'person', aliases: ['Olivier', 'le chef de chantier', 'Meunier'] },
  { key: 'ent:karine-waheo', label: 'Karine Wahéo', type: 'person', aliases: ['Karine', 'Wahéo'] },
  { key: 'ent:felix-katrawi', label: 'Félix Katrawi', type: 'person', aliases: ['Félix', 'le responsable technique'] },
  { key: 'ent:alice-nondas', label: 'Alice Nondas', type: 'person', aliases: ['Alice', 'Mme Nondas'] },
  { key: 'ent:thierry-paoua', label: 'Thierry Paoua', type: 'person', aliases: ['Thierry', 'Paoua'] },
  { key: 'ent:beatrice-kavo', label: 'Béatrice Kavouoatai', type: 'person', aliases: ['Béatrice', 'Mme Kavouoatai', 'Bé'] },
] as const

const COMPANY_ENTITIES = [
  { key: 'ent:clim-expair', label: 'Clim Expair', type: 'company', aliases: ['Expair', 'Clim Expair', 'la clim'] },
  { key: 'ent:elec-plus', label: 'Élec Plus NC', type: 'company', aliases: ['Élec Plus', 'les électriciens', "l'élec"] },
  { key: 'ent:sotraval', label: 'Sotraval', type: 'company', aliases: ['Sotraval', 'la maintenance'] },
  { key: 'ent:sopac', label: 'SOPAC Sécurité', type: 'company', aliases: ['SOPAC', 'la sécurité'] },
  { key: 'ent:btp-nc', label: 'BTP Nouvelle-Calédonie', type: 'company', aliases: ['BTP NC', 'les travaux'] },
  { key: 'ent:engie-nc', label: 'Engie NC', type: 'company', aliases: ['Engie', 'le gestionnaire réseau'] },
  { key: 'ent:calypso-extincteurs', label: 'Calypso Extincteurs', type: 'company', aliases: ['Calypso', 'les extincteurs'] },
  { key: 'ent:saur-nc', label: 'SAUR NC', type: 'company', aliases: ['SAUR', 'les sprinklers'] },
] as const

// Pools de contenu pour debrief_analysis
const ACTION_POOL = [
  { title: 'Remplacer les extincteurs du local technique', owner: 'Marc Rodriguez', priority: 'haute' as const, rationale: "Extincteurs hors délai de contrôle — risque réglementaire immédiat." },
  { title: 'Vérifier le bon fonctionnement du désenfumage', owner: 'Fatima Ouali', priority: 'haute' as const, rationale: "Clapet non testé depuis plus de 12 mois." },
  { title: 'Dégager les issues de secours du couloir nord', owner: 'Olivier Meunier', priority: 'haute' as const, rationale: "Palettes stockées devant la porte coupe-feu — obstruction totale." },
  { title: 'Mettre à jour le registre de sécurité', owner: 'Claire Tétuanui', priority: 'moyenne' as const, rationale: "Dernière mise à jour datée de plus de 6 mois." },
  { title: 'Planifier la formation évacuation du personnel', owner: 'Karine Wahéo', priority: 'moyenne' as const, rationale: "Aucun exercice d'évacuation réalisé cette année." },
  { title: 'Réparer la porte coupe-feu du couloir est', owner: 'Luc Barnard', priority: 'haute' as const, rationale: "Joint d'étanchéité dégradé — porte ne se ferme plus correctement." },
  { title: 'Installer les balisages de secours manquants', owner: 'Félix Katrawi', priority: 'haute' as const, rationale: "Deux sorties de secours sans signalisation lumineuse active." },
  { title: 'Tester les détecteurs de fumée en zone stockage', owner: 'Marc Rodriguez', priority: 'moyenne' as const, rationale: "Défaut de test signalé par la centrale lors de la dernière alarme." },
  { title: 'Mettre en conformité les issues de secours du sous-sol', owner: 'Fatima Ouali', priority: 'haute' as const, rationale: "Non-conformité relevée au regard du code de la construction." },
  { title: 'Programmer une évacuation test ce trimestre', owner: 'Claire Tétuanui', priority: 'basse' as const, rationale: "Obligation réglementaire annuelle — délai quasi dépassé." },
  { title: "Contrôler l'état des colonnes sèches", owner: 'Thierry Paoua', priority: 'moyenne' as const, rationale: "Aucune vérification depuis l'installation (3 ans)." },
  { title: 'Remplacer les têtes de sprinklers endommagées', owner: 'Alice Nondas', priority: 'haute' as const, rationale: "Deux têtes corrodées visibles dans l'entrepôt B." },
] as const

const WATCHPOINT_POOL = [
  { label: 'Local électrique non verrouillé', impact: 'Accès non contrôlé, risque de court-circuit ou manipulation accidentelle' },
  { label: 'Produits inflammables mal stockés', impact: "Risque incendie majeur en cas d'étincelle ou de chaleur excessive" },
  { label: 'Extincteur hors date de contrôle', impact: 'Non-conformité réglementaire — appareil potentiellement inopérant' },
  { label: 'Couloir principal encombré par des palettes', impact: "Obstruction de la voie d'évacuation principale" },
  { label: 'Alarme incendie non testée depuis 6 mois', impact: "Doute sur l'efficacité du déclenchement en cas de sinistre" },
  { label: 'Panneau de sécurité absent au sous-sol', impact: "Non-visibilité des consignes d'évacuation" },
  { label: 'Groupe électrogène de secours défaillant', impact: "Absence d'alimentation de secours pour les systèmes critiques" },
  { label: 'Vanne sprinkler partiellement fermée', impact: "Zone non protégée en cas d'incendie" },
] as const

const DECISION_POOL = [
  "Renouveler le contrat de maintenance des extincteurs pour l'exercice suivant",
  "Valider le plan d'évacuation révisé avec la direction de l'établissement",
  'Commander 12 extincteurs CO₂ supplémentaires pour le niveau 2',
  'Mandater Sotraval pour la mise en conformité du local sprinklers',
  'Programmer la prochaine inspection dans 3 mois',
  'Transmettre le rapport de non-conformité à la direction en priorité',
  'Formaliser le registre de sécurité en version numérique',
  'Valider le planning de formation évacuation avec les RH',
] as const

const SUMMARY_POOL = [
  "Inspection incendie réalisée sur l'ensemble de l'établissement. Plusieurs points de non-conformité identifiés, notamment côté local technique et issue de secours nord. Les équipes sont informées et un plan d'actions a été convenu sur site.",
  "Visite de contrôle semestrielle. L'état général est satisfaisant. Quelques réserves mineures ont été relevées et seront traitées dans les 30 jours. Registre de sécurité à mettre à jour.",
  "Première visite post-travaux. Les installations rénovées sont conformes au regard de la réglementation. Un point de vigilance subsiste sur le désenfumage du sous-sol — un test complet est à planifier.",
  "Contrôle annuel des équipements incendie. Extincteurs en ordre, système d'alarme opérationnel. Formation évacuation à prévoir avant fin d'année — aucun exercice réalisé depuis 14 mois.",
  "Visite suite à incident signalé (déclenchement intempestif). Constat établi : fausse alarme due à des travaux. Mesures correctives validées avec le responsable de site. Suivi prévu dans 30 jours.",
  "Audit initial du site dans le cadre du nouveau contrat CAPSE. Cartographie des équipements réalisée, registre de sécurité contrôlé. 3 actions prioritaires identifiées, transmises au responsable.",
] as const

const OBJECTIVE_POOL = [
  'Inspection réglementaire incendie',
  'Contrôle périodique des équipements de sécurité',
  'Visite de suivi des actions correctives',
  'Audit initial du site',
  'Vérification post-travaux',
  "Contrôle annuel — systèmes d'alarme et désenfumage",
] as const

const TITLE_POOL = [
  'Inspection sécurité incendie',
  'Contrôle semestriel',
  'Visite de suivi',
  'Audit initial',
  'Vérification post-travaux',
  'Inspection réglementaire annuelle',
  'Contrôle équipements',
  'Visite de levée de réserves',
] as const

const MOTIVES = ['inspection', 'controle', 'avancement', 'levee_reserves', 'maintenance', 'libre'] as const
const OUTCOMES = ['conforme', 'conforme_reserves', 'non_conforme', 'a_revoir'] as const

// ── Équipes internes CAPSE ─────────────────────────────────────────────────────

const TEAMS = [
  { key: 'team:insp-nord', name: 'Inspection Nord', color: '#3b82f6', members: ['jp.kaemo', 'sophie.wane'] },
  { key: 'team:insp-sud', name: 'Inspection Sud', color: '#10b981', members: ['patrick.djiril'] },
  { key: 'team:audit', name: 'Audit & Conformité', color: '#8b5cf6', members: ['marie.lefevre'] },
] as const

// ── Entreprises intervenantes (pour site_intervenants) ────────────────────────

const CONTRACTORS = [
  {
    key: 'co:sotraval', name: 'Sotraval', city: 'Dumbéa', phone: '+687 41 33 20',
    contacts: [{ key: 'cc:thierry-paoua', name: 'Thierry Paoua', fn: 'Conducteur de travaux', mobile: '+687 71 33 20' }],
  },
  {
    key: 'co:sopac', name: 'SOPAC Sécurité', city: 'Nouméa', phone: '+687 26 18 50',
    contacts: [{ key: 'cc:luc-barnard', name: 'Luc Barnard', fn: 'Agent de sécurité référent', mobile: '+687 76 18 50' }],
  },
  {
    key: 'co:calypso', name: 'Calypso Extincteurs', city: 'Nouméa', phone: '+687 27 40 60',
    contacts: [{ key: 'cc:alice-nondas', name: 'Alice Nondas', fn: 'Technicienne sprinklers', mobile: '+687 77 40 60' }],
  },
  {
    key: 'co:elec-plus', name: 'Élec Plus NC', city: 'Nouméa', phone: '+687 28 42 10',
    contacts: [{ key: 'cc:felix-katrawi', name: 'Félix Katrawi', fn: "Chef d'équipe électricité", mobile: '+687 78 42 10' }],
  },
  {
    key: 'co:clim-expair', name: 'Clim Expair', city: 'Nouméa', phone: '+687 24 15 30',
    contacts: [{ key: 'cc:marc-rodriguez', name: 'Marc Rodriguez', fn: 'Responsable technique', mobile: '+687 74 15 30' }],
  },
  {
    key: 'co:btp-nc', name: 'BTP Nouvelle-Calédonie', city: 'Dumbéa', phone: '+687 41 55 80',
    contacts: [{ key: 'cc:olivier-meunier', name: 'Olivier Meunier', fn: 'Conducteur de travaux', mobile: '+687 71 55 80' }],
  },
] as const

// Rôles d'intervenant — 2-3 par site, rotation par index
const SITE_ROLES = [
  { role: 'Maintenance générale', coIdx: 0 },
  { role: 'Sécurité incendie', coIdx: 1 },
  { role: 'Extincteurs & sprinklers', coIdx: 2 },
  { role: 'Électricité', coIdx: 3 },
  { role: 'Climatisation', coIdx: 4 },
] as const

// Captures de visite — texte libre de notes de terrain
const CAPTURE_NOTES = [
  "Extincteur vérifié — étiquette de contrôle à jour.",
  "Issue de secours dégagée, signalisation conforme.",
  "Détecteur de fumée testé — déclenchement OK.",
  "Local électrique fermé à clé, câbles organisés.",
  "Réserve constatée : palette devant la porte coupe-feu.",
  "Registre de sécurité à jour, dernière signature datée de ce mois.",
  "Vanne sprinkler ouverte et positionnée correctement.",
  "Point de rassemblement balisé, plan d'évacuation affiché.",
  "Groupe électrogène testé — autonomie 4h confirmée.",
  "Clapet de désenfumage manœuvré — fermeture étanche.",
] as const

// ════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION D'UN DEBRIEF_ANALYSIS
// ════════════════════════════════════════════════════════════════════════════════

function makeDebriefAnalysis(siteKey: string, visitIdx: number, startedAt: Date, outcome: string): object {
  const seed = `da:${siteKey}:${visitIdx}`
  const actionCount = 2 + (visitIdx % 3)
  const actions = pickN(ACTION_POOL, actionCount, seed + ':a').map((a, i) => ({
    title: a.title,
    rationale: a.rationale,
    priority: a.priority,
    owner: a.owner,
    due: isoDate(addDays(TODAY_STR, -60 + i * 20)),
  }))
  const watchpoints = pickN(WATCHPOINT_POOL, 1 + (visitIdx % 2), seed + ':w').map((w, i) => ({
    label: w.label,
    impact: w.impact,
    owner: pick(PEOPLE_ENTITIES, seed + ':wo' + i).label,
    due: '',
  }))
  const decisions = pickN(DECISION_POOL, 1 + (visitIdx % 2), seed + ':d')
  const corpusHash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16)
  const generatedAt = new Date(startedAt.getTime() + 2 * 3600 * 1000).toISOString()
  const intervenants = [pick(PEOPLE_ENTITIES, seed + ':i').label]

  const actionLedger = actions.map((a) => ({
    key: crypto.createHash('sha1')
      .update(a.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim())
      .digest('hex').slice(0, 16),
    title: a.title,
    rationale: a.rationale,
    priority: a.priority,
    owner: a.owner,
    due: a.due,
    state: 'open',
    version_added: 1,
  }))

  return {
    summary: pick(SUMMARY_POOL, seed + ':s'),
    decisions,
    actions,
    watchpoints,
    a_savoir: ['Accès au local technique : badge niveau 2 obligatoire.'],
    echeances: actions.slice(0, 1).map((a) => ({ label: a.title, date: a.due, constraint: '' })),
    intervenants,
    attention: [],
    open_questions: [],
    forgotten_obligations: [],
    objective: pick(OBJECTIVE_POOL, seed + ':o'),
    objective_rationale: 'Objectif déduit du contexte et du type de visite.',
    objective_confidence: 'elevee',
    subject_match_index: -1,
    subject_name: '',
    subject_rationale: '',
    subject_confidence: null,
    outcome,
    resolution: null,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    generated_at: generatedAt,
    corpus_hash: corpusHash,
    schema_version: 'v7-echeances-ancrees',
    analysis_version: 1,
    source_snapshot: {
      photos: 2 + (visitIdx % 5),
      videos: 0,
      vocals: 1,
      notes: 1 + (visitIdx % 3),
      last_capture_at: generatedAt,
    },
    action_ledger: actionLedger,
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// SEED FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

async function seedOrg() {
  console.log('  Org CAPSE Démonstration…')
  await runSql(`
    INSERT INTO public.organizations (id, name, slug, is_demo, demo_seed_key)
    VALUES (
      '${ORG_ID}',
      'CAPSE Démonstration',
      'capse-demo',
      true,
      '${SEED_KEY}'
    )
    ON CONFLICT (id) DO UPDATE SET
      name        = EXCLUDED.name,
      is_demo     = true,
      demo_seed_key = EXCLUDED.demo_seed_key
  `)
}

async function seedUsers(): Promise<Record<string, string>> {
  console.log('  Auth users…')
  const authIds: Record<string, string> = {}
  for (const u of USERS) {
    authIds[u.key] = await createAuthUser(u.email, u.name)
    process.stdout.write(`    ${u.email}\n`)
  }

  const userVals = USERS.map((u) => `(
    '${authIds[u.key]}',
    ${esc(u.email)},
    ${esc(u.name)},
    '${u.role}'::user_role,
    '${ORG_ID}',
    '${u.homePreference}'
  )`).join(',')
  await runSql(`
    INSERT INTO public.users (id, email, full_name, role, organization_id, home_preference)
    VALUES ${userVals}
    ON CONFLICT (id) DO UPDATE SET
      full_name       = EXCLUDED.full_name,
      role            = EXCLUDED.role,
      organization_id = EXCLUDED.organization_id,
      home_preference = EXCLUDED.home_preference
  `)

  const membVals = USERS.map((u) => `(
    '${duid('mem:' + u.key)}',
    '${authIds[u.key]}',
    '${ORG_ID}',
    '${u.role}'::user_role,
    'active'
  )`).join(',')
  await runSql(`
    INSERT INTO public.organization_memberships (id, user_id, organization_id, role, status)
    VALUES ${membVals}
    ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
  `)

  return authIds
}

async function seedClients() {
  console.log('  Clients…')
  const vals = CLIENTS.map((c) => `(
    '${duid('client:' + c.key)}',
    ${esc(c.name)},
    ${esc('Responsable ' + c.name)},
    ${esc(c.key + '@demo-capse.nc')},
    ${esc(c.phone)},
    ${esc(c.address)},
    NULL,
    '${ORG_ID}'
  )`).join(',')
  await runSql(`
    INSERT INTO public.clients (id, name, contact_name, contact_email, contact_phone, address, notes, organization_id)
    VALUES ${vals}
    ON CONFLICT (id) DO NOTHING
  `)
}

async function seedSites() {
  console.log('  Sites…')
  const vals = SITES.map((s) => `(
    '${duid('site:' + s.key)}',
    '${duid('client:' + s.clientKey)}',
    ${esc(s.name)},
    ${esc(s.address)},
    NULL,
    '${ORG_ID}'
  )`).join(',')
  await runSql(`
    INSERT INTO public.sites (id, client_id, name, address, notes, organization_id)
    VALUES ${vals}
    ON CONFLICT (id) DO NOTHING
  `)
}

async function seedKnowledgeEntities(createdBy: string) {
  console.log('  Knowledge entities…')
  const allEntities = [...PEOPLE_ENTITIES, ...COMPANY_ENTITIES]

  const entityVals = allEntities.map((e) => `(
    '${duid(e.key)}',
    '${ORG_ID}',
    ${esc(e.label)},
    '${e.type}',
    1.0,
    true,
    'manual',
    '{}',
    '${createdBy}'
  )`).join(',')
  await runSql(`
    INSERT INTO public.site_knowledge_entities
      (id, organization_id, canonical_label, entity_type, confidence, is_active, source, metadata, created_by)
    VALUES ${entityVals}
    ON CONFLICT (id) DO NOTHING
  `)

  const aliasRows: string[] = []
  for (const e of allEntities) {
    e.aliases.forEach((alias, i) => {
      const norm = alias
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
      aliasRows.push(`(
        '${duid(e.key + ':al:' + i)}',
        '${duid(e.key)}',
        ${esc(alias)},
        ${esc(norm)}
      )`)
    })
  }
  await runSql(`
    INSERT INTO public.site_knowledge_entity_aliases (id, entity_id, alias, alias_norm)
    VALUES ${aliasRows.join(',')}
    ON CONFLICT (entity_id, alias_norm) DO NOTHING
  `)
}

async function seedReportsForSite(site: (typeof SITES)[number], createdBy: string) {
  const siteId = duid('site:' + site.key)
  const rows: string[] = []

  // 4 past visits — spread over ~6 months
  for (let v = 0; v < 4; v++) {
    const rid = duid(`rp:${site.key}:v${v}`)
    const daysBack = 20 + Math.floor((v / 4) * 155) // 20..175 days ago
    const startedAt = addDays(TODAY_STR, -daysBack)
    const endedAt = new Date(startedAt.getTime() + 2.5 * 3600 * 1000)
    const outcome = pick(OUTCOMES, `${site.key}:v${v}:out`)
    const motive = pick(MOTIVES, `${site.key}:v${v}:mot`)
    const title = pick(TITLE_POOL, `${site.key}:v${v}:title`)
    const objective = pick(OBJECTIVE_POOL, `${site.key}:v${v}:obj`)
    const analysis = makeDebriefAnalysis(site.key, v, startedAt, outcome)
    rows.push(`(
      '${rid}', '${siteId}', '${ORG_ID}', '${ORG_ID}',
      'curated', 'done', 'planned',
      ${esc(pgTs(startedAt))}, ${esc(pgTs(endedAt))},
      ${esc(title)}, ${esc(motive)}, ${esc(objective)}, '${outcome}',
      ${escJson(analysis)},
      '${createdBy}',
      ${esc(pgTs(startedAt))}
    )`)
  }

  // 2 past meetings (origin IS NULL)
  for (let m = 0; m < 2; m++) {
    const rid = duid(`rp:${site.key}:m${m}`)
    const startedAt = addDays(TODAY_STR, -(30 + m * 45))
    rows.push(`(
      '${rid}', '${siteId}', '${ORG_ID}', '${ORG_ID}',
      'curated', 'none', NULL,
      ${esc(pgTs(startedAt))}, NULL,
      ${esc(m === 0 ? 'Réunion de suivi mensuelle' : 'Bilan trimestriel de sécurité')},
      NULL, NULL, NULL,
      NULL,
      '${createdBy}',
      ${esc(pgTs(startedAt))}
    )`)
  }

  // 2 future visits
  for (let f = 0; f < 2; f++) {
    const rid = duid(`rp:${site.key}:f${f}`)
    const startedAt = addDays(TODAY_STR, 14 + f * 28)
    rows.push(`(
      '${rid}', '${siteId}', '${ORG_ID}', '${ORG_ID}',
      'draft', 'none', 'planned',
      ${esc(pgTs(startedAt))}, NULL,
      ${esc(f === 0 ? 'Visite planifiée — contrôle semestriel' : 'Inspection réglementaire programmée')},
      NULL, NULL, NULL,
      NULL,
      '${createdBy}',
      ${esc(pgTs(startedAt))}
    )`)
  }

  await runSql(`
    INSERT INTO public.site_reports
      (id, site_id, organization_id, tenant_id,
       status, transcript_status, origin,
       started_at, ended_at,
       title, visit_motive, objective, outcome,
       debrief_analysis,
       created_by, created_at)
    VALUES ${rows.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)
}

async function seedProposalsForSite(site: (typeof SITES)[number]) {
  const siteId = duid('site:' + site.key)
  const KINDS = ['action', 'vigilance', 'decision', 'knowledge'] as const
  const rows: string[] = []

  for (let v = 0; v < 4; v++) {
    const reportId = duid(`rp:${site.key}:v${v}`)
    const count = 2 + (v % 3)
    for (let p = 0; p < count; p++) {
      const pid = duid(`prop:${site.key}:v${v}:${p}`)
      const kind = pick(KINDS, `${site.key}:v${v}:p${p}:k`)
      const status = v < 3 ? 'confirmed' : 'proposed'
      let title: string
      let body: string | null = null
      if (kind === 'action') {
        const a = pick(ACTION_POOL, `${site.key}:v${v}:p${p}:a`)
        title = a.title
        body = a.rationale
      } else if (kind === 'decision') {
        title = pick(DECISION_POOL, `${site.key}:v${v}:p${p}:d`)
      } else if (kind === 'vigilance') {
        const w = pick(WATCHPOINT_POOL, `${site.key}:v${v}:p${p}:w`)
        title = w.label
        body = w.impact
      } else {
        title = 'Accès local technique : badge niveau 2 requis.'
      }
      const dedupeKey = `${SEED_KEY}:${site.key}:v${v}:p${p}`
      rows.push(`(
        '${pid}',
        '${ORG_ID}',
        '${siteId}',
        '${reportId}',
        1,
        '${kind}',
        '${status}',
        ${esc(title)},
        ${esc(body)},
        '{}',
        NULL,
        '{}',
        ${esc(dedupeKey)}
      )`)
    }
  }

  if (rows.length === 0) return
  await runSql(`
    INSERT INTO public.site_knowledge_proposals
      (id, organization_id, site_id, report_id, analysis_version,
       kind, status, title, body, payload, confidence, source_capture_ids, dedupe_key)
    VALUES ${rows.join(',')}
    ON CONFLICT (site_id, dedupe_key) DO NOTHING
  `)
}

// ════════════════════════════════════════════════════════════════════════════════
// FONCTIONS OPÉRATIONNELLES (écrans Équipes, Planning, Chantier, Visite)
// ════════════════════════════════════════════════════════════════════════════════

async function seedTeams(authIds: Record<string, string>) {
  console.log('  Équipes CAPSE…')
  const adminId = authIds['david.bouvier']

  const teamVals = TEAMS.map(t => `(
    '${duid(t.key)}', ${esc(t.name)}, ${esc(t.color)}, true, '${ORG_ID}', '${adminId}'
  )`).join(',')
  await runSql(`
    INSERT INTO public.teams (id, name, color, active, organization_id, created_by)
    VALUES ${teamVals}
    ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id
  `)

  const memberRows: string[] = []
  for (const t of TEAMS) {
    for (const userKey of t.members) {
      memberRows.push(`(
        '${duid('tmem:' + t.key + ':' + userKey)}',
        '${duid(t.key)}',
        '${authIds[userKey as keyof typeof authIds]}',
        '${ORG_ID}'
      )`)
    }
  }
  await runSql(`
    INSERT INTO public.team_members (id, team_id, user_id, organization_id)
    VALUES ${memberRows.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)
  process.stdout.write(`    ${TEAMS.length} équipes, ${memberRows.length} membres\n`)
}

async function seedContractors() {
  console.log('  Entreprises intervenantes…')

  const coVals = CONTRACTORS.map(c => `(
    '${duid(c.key)}', '${ORG_ID}', ${esc(c.name)}, ${esc(c.city)}, ${esc(c.phone)}
  )`).join(',')
  await runSql(`
    INSERT INTO public.companies (id, organization_id, name, city, phone)
    VALUES ${coVals}
    ON CONFLICT (id) DO NOTHING
  `)

  const contactVals: string[] = []
  for (const c of CONTRACTORS) {
    for (const ct of c.contacts) {
      contactVals.push(`(
        '${duid(ct.key)}', '${duid(c.key)}', '${ORG_ID}', ${esc(ct.name)}, ${esc(ct.fn)}, ${esc(ct.mobile)}, true
      )`)
    }
  }
  await runSql(`
    INSERT INTO public.company_contacts (id, company_id, organization_id, full_name, function, mobile, is_main)
    VALUES ${contactVals.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)
  process.stdout.write(`    ${CONTRACTORS.length} entreprises, ${contactVals.length} contacts\n`)
}

async function seedSiteIntervenants() {
  console.log('  Intervenants par chantier…')
  const rows: string[] = []

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId = duid('site:' + site.key)
    const roleCount = 2 + (si % 2) // 2 ou 3 rôles par site
    for (let r = 0; r < roleCount; r++) {
      const roleEntry = SITE_ROLES[(si + r) % SITE_ROLES.length]
      const co = CONTRACTORS[roleEntry.coIdx]
      const mainContact = co.contacts[0]
      rows.push(`(
        '${duid('si:' + site.key + ':' + r)}',
        '${siteId}',
        ${esc(roleEntry.role)},
        '${duid(co.key)}',
        '${duid(mainContact.key)}'
      )`)
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await runSql(`
      INSERT INTO public.site_intervenants (id, site_id, role, company_id, main_contact_id)
      VALUES ${rows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
  }
  process.stdout.write(`    ${rows.length} rattachements site↔entreprise\n`)
}

async function seedMissions(authIds: Record<string, string>) {
  console.log(`  Missions & interventions (${SITES.length} sites × 2 missions × 6 interventions)…`)
  const adminId = authIds['david.bouvier']

  const missionRows: string[] = []
  const interventionRows: string[] = []

  const missionDefs = [
    { suffix: 'm0', name: 'Inspection mensuelle sécurité incendie', cadence: 'monthly' },
    { suffix: 'm1', name: 'Contrôle extincteurs & sprinklers', cadence: 'on_demand' },
  ] as const

  const intSchedule = [
    { offset: -90, status: 'completed' },
    { offset: -60, status: 'completed' },
    { offset: -30, status: 'completed' },
    { offset: -10, status: 'completed' },
    { offset: 20, status: 'planned' },
    { offset: 50, status: 'planned' },
  ] as const

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId = duid('site:' + site.key)
    const teamId = duid(TEAMS[si % 3].key)

    for (const md of missionDefs) {
      const missionId = duid(`mission:${site.key}:${md.suffix}`)
      missionRows.push(`(
        '${missionId}', '${siteId}', ${esc(md.name)},
        '${md.cadence}'::mission_cadence, true, '${ORG_ID}', '${adminId}'
      )`)

      for (let ii = 0; ii < intSchedule.length; ii++) {
        const { offset, status } = intSchedule[ii]
        const intId = duid(`int:${site.key}:${md.suffix}:${ii}`)
        const scheduledAt = addDays(TODAY_STR, offset)
        scheduledAt.setHours(8, 0, 0, 0)
        interventionRows.push(`(
          '${intId}', '${missionId}',
          ${esc(pgTs(scheduledAt))}, '${isoDate(scheduledAt)}',
          '${status}'::intervention_status, '${teamId}',
          '${ORG_ID}', '${adminId}'
        )`)
      }
    }
  }

  for (let i = 0; i < missionRows.length; i += 50) {
    await runSql(`
      INSERT INTO public.missions (id, site_id, name, cadence, active, organization_id, created_by)
      VALUES ${missionRows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
  }
  process.stdout.write(`    ${missionRows.length} missions\n`)

  for (let i = 0; i < interventionRows.length; i += 50) {
    await runSql(`
      INSERT INTO public.interventions
        (id, mission_id, scheduled_at, scheduled_for, status, assigned_team_id, organization_id, created_by)
      VALUES ${interventionRows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${interventionRows.length} interventions\n`)
}

async function seedSiteActions(authIds: Record<string, string>) {
  console.log('  Actions ouvertes par chantier…')
  const adminId = authIds['david.bouvier']
  const rows: string[] = []

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId = duid('site:' + site.key)
    const reportId = duid(`rp:${site.key}:v0`)
    const count = 3 + (si % 2)

    for (let ai = 0; ai < count; ai++) {
      const action = pick(ACTION_POOL, `sa:${site.key}:${ai}`)
      const aId = duid(`sa:${site.key}:${ai}`)
      const dueDate = isoDate(addDays(TODAY_STR, -30 + ai * 18))
      rows.push(`(
        '${aId}', '${siteId}', '${reportId}',
        ${esc(action.title)}, ${esc(action.rationale)},
        'Sécurité incendie', ${esc(action.owner)},
        'open', '${dueDate}', '${adminId}'
      )`)
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await runSql(`
      INSERT INTO public.site_actions
        (id, site_id, report_id, title, body, corps_etat, assigned_to, status, due_date, created_by)
      VALUES ${rows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${rows.length} actions\n`)
}

async function seedVisitCaptures(authIds: Record<string, string>) {
  console.log('  Captures de visite…')
  const adminId = authIds['david.bouvier']
  const rows: string[] = []

  for (const site of SITES) {
    const siteId = duid('site:' + site.key)
    for (let v = 0; v < 4; v++) {
      const reportId = duid(`rp:${site.key}:v${v}`)
      const captureCount = 3 + (v % 2)
      for (let c = 0; c < captureCount; c++) {
        const note = pick(CAPTURE_NOTES, `vc:${site.key}:v${v}:c${c}`)
        const kind = c === 0 ? 'verification' : 'note'
        rows.push(`(
          '${duid('vc:' + site.key + ':v' + v + ':' + c)}',
          '${ORG_ID}', '${siteId}', '${reportId}',
          '${kind}', 'processed',
          ${esc(note)}, '${adminId}'
        )`)
      }
    }
  }

  for (let i = 0; i < rows.length; i += 100) {
    await runSql(`
      INSERT INTO public.visit_capture
        (id, organization_id, site_id, report_id, kind, status, body, created_by)
      VALUES ${rows.slice(i, i + 100).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${rows.length} captures\n`)
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🌱 Seed CAPSE Démonstration — capse-2026-v1\n')
  console.log(`Org ID : ${ORG_ID}`)
  console.log(`Supabase : ${SUPABASE_URL}\n`)

  if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN manquant dans .env.local')
  if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local')

  await seedOrg()
  const authIds = await seedUsers()
  const adminId = authIds['david.bouvier']
  await seedClients()
  await seedSites()
  await seedKnowledgeEntities(adminId)

  console.log(`  Reports (${SITES.length} sites × 8 reports)…`)
  for (const site of SITES) {
    await seedReportsForSite(site, adminId)
    process.stdout.write('.')
  }
  console.log()

  console.log('  Proposals…')
  for (const site of SITES) {
    await seedProposalsForSite(site)
    process.stdout.write('.')
  }
  console.log()

  // Écrans opérationnels — Équipes, Planning, Chantier, Visite
  await seedTeams(authIds)
  await seedContractors()
  await seedSiteIntervenants()
  await seedMissions(authIds)
  await seedSiteActions(authIds)
  await seedVisitCaptures(authIds)

  console.log('\n✅ Seed terminé.')
  console.log(`  Org          : CAPSE Démonstration (${ORG_ID})`)
  console.log(`  Admin        : david.bouvier.test@memoria.nc — ${PASSWORD}`)
  console.log(`  Clients      : ${CLIENTS.length}`)
  console.log(`  Sites        : ${SITES.length}`)
  console.log(`  Équipes      : ${TEAMS.length} (${TEAMS.map(t => t.name).join(', ')})`)
  console.log(`  Entreprises  : ${CONTRACTORS.length} avec contacts`)
  console.log(`  Reports/site : 4 visites passées + 2 réunions + 2 futures = 8`)
  console.log(`  Total reports: ~${SITES.length * 8}`)
  console.log(`  Missions     : ${SITES.length * 2} (2/site)`)
  console.log(`  Interventions: ${SITES.length * 2 * 6} (6/mission)`)
  console.log(`  Actions      : ~${SITES.length * 3} (3-4/site)`)
  console.log(`  Captures     : ~${SITES.length * 4 * 3} (3-4/visite passée)`)
}

main().catch((e) => {
  console.error('\n❌', e.message)
  process.exit(1)
})
