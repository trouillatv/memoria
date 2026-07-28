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
  { key: 'cps-nc',      name: 'CPS – Caisse de Protection Sociale', address: 'Quartier Latin, Nouméa',             phone: '+687 25 18 00' },
  { key: 'smsp-tower',  name: 'SMSP Tower',                         address: '1 Place des Cocotiers, Nouméa',       phone: '+687 23 65 00' },
  { key: 'hilton-noumea', name: 'Hôtel Hilton Nouméa',              address: '2 Promenade Roger Laroque, Nouméa',   phone: '+687 26 90 00' },
  { key: 'dumbea-mall', name: 'Dumbéa Mall',                        address: 'Route de Tontouta, Dumbéa',           phone: '+687 41 19 20' },
] as const

const SITES = [
  { key: 'cps-siege',    clientKey: 'cps-nc',       name: 'Siège social',            address: 'Quartier Latin, Nouméa' },
  { key: 'cps-dumbea',   clientKey: 'cps-nc',       name: 'Antenne Dumbéa',          address: 'Centre Dumbéa, Route de Tontouta' },
  { key: 'smsp-plateau3', clientKey: 'smsp-tower',  name: 'Plateau 3e étage',        address: 'SMSP Tower, 3e étage, Nouméa' },
  { key: 'smsp-plateau8', clientKey: 'smsp-tower',  name: 'Plateau 8e étage',        address: 'SMSP Tower, 8e étage, Nouméa' },
  { key: 'hilton-rdc',   clientKey: 'hilton-noumea', name: 'Rez-de-chaussée et lobby', address: 'Promenade R. Laroque — RDC, Nouméa' },
  { key: 'dumbea-galerie', clientKey: 'dumbea-mall', name: 'Galerie principale',     address: 'Dumbéa Mall, Niveau 1' },
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
// SHOWCASE — CPS Siège social (site pilote de démonstration)
// ════════════════════════════════════════════════════════════════════════════════

const SHOWCASE_SITE_KEY = 'cps-siege'

const SHOWCASE_VISITS = [
  {
    key: 'sc0',
    daysBack: 8,
    title: 'Inspection sécurité incendie trimestrielle',
    motive: 'inspection',
    objective: 'Inspection réglementaire incendie',
    outcome: 'conforme_reserves',
    captures: [
      { kind: 'verification', body: 'Extincteurs RDC — 12 appareils vérifiés. Étiquettes de contrôle à jour, dernier passage le 15/03/2026. Prochain avant le 15/09/2026. Charge correcte sur 12/12. Aucune anomalie.' },
      { kind: 'note',         body: 'Marc Rodriguez (Clim Expair) présent à l\'accueil. Signale une anomalie sur le désenfumage du sous-sol — clapet couloir B ne se ferme plus complètement depuis une semaine. Priorité à traiter immédiatement.' },
      { kind: 'verification', body: 'Issues de secours niveau 1 (3 sorties). Toutes dégagées, signalisation conforme. Balisage lumineux fonctionnel. Gond légèrement grippé sur issue nord — porte s\'ouvre à 80° max au lieu de 90° réglementaire.' },
      { kind: 'note',         body: 'Alice Nondas (Calypso) présente pour vérification réseau sprinklers. Tête corrodée relevée en travée D4 — remplacement à programmer sous 30 jours. Pression réseau 5,4 bars, dans la plage admissible.' },
      { kind: 'verification', body: 'Système alarme incendie testé. Centrale ZX5, 4 zones. Zones 1, 2, 3 : déclenchement correct (< 3s). Zone 4 (sous-sol) : délai de propagation mesuré à 8s au lieu de 3s max — anomalie confirmée.' },
      { kind: 'note',         body: 'Local technique RDC : rangement correct, accès balisé. Extincteur CO₂ 2kg vérifié. Boîtier de report alarme incendie : vitre brisée — à remplacer. Risque de fausse manipulation en l\'état.' },
      { kind: 'verification', body: 'Colonnes sèches : 2 colonnes examinées. Bouchons en place, manomètres lisibles. Vannes d\'alimentation pompiers accessibles et déverrouillées. État général satisfaisant.' },
      { kind: 'note',         body: 'Responsable RH CPS, Fatima Ouali, demande à intégrer un exercice évacuation avant fin septembre 2026. Engagement de CAPSE de proposer un créneau dans les 15 jours suivant ce rapport.' },
      { kind: 'verification', body: 'Registre de sécurité consulté. Dernière mise à jour le 18/06/2026. Signatures présentes sur les 6 derniers contrôles. Registre conforme aux exigences réglementaires.' },
      { kind: 'note',         body: 'Clapet de désenfumage CB-04 (couloir B, sous-sol) manœuvré manuellement : fermeture incomplète confirmée — jeu résiduel estimé à 8 mm. Intervention Sotraval à déclencher en urgence (délai max 72h).' },
      { kind: 'verification', body: 'Blocs de sécurité portes coupe-feu : 8 blocs testés. 7 conformes. Bloc escalier A : ressort de fermeture affaibli, porte reste entrouverte. Non-conformité relevée.' },
      { kind: 'note',         body: 'Fin d\'inspection. Rapport signé par David Bouvier (CAPSE) et Marc Rodriguez (Clim Expair). Plan d\'actions transmis à Fatima Ouali (CPS) — 3 points dont 1 urgence désenfumage.' },
    ],
    stakeholders: [
      { label: 'Marc Rodriguez (Clim Expair)', role: 'Responsable technique — présent à l\'accueil et en fin d\'inspection, cosignataire du rapport de visite.' },
      { label: 'Alice Nondas (Calypso)',       role: 'Technicienne sprinklers — vérification du réseau sprinklers sur l\'ensemble du bâtiment, identification tête corrodée D4.' },
      { label: 'Fatima Ouali (CPS)',            role: 'Responsable sécurité CPS — accompagnement de l\'inspection, demande planification exercice évacuation.' },
    ],
  },
  {
    key: 'sc1',
    daysBack: 35,
    title: 'Contrôle extincteurs & sprinklers',
    motive: 'controle',
    objective: 'Contrôle périodique des équipements de sécurité',
    outcome: 'conforme',
    captures: [
      { kind: 'verification', body: 'Extincteurs — recensement complet : 38 appareils répartis sur 4 niveaux. 36 conformes. 2 hors délai en niveau 2 — remplacement prévu en semaine 32 (bons de commande signés).' },
      { kind: 'note',         body: 'Alice Nondas (Calypso) conduit la vérification complète du réseau sprinklers. Durée estimée : 3h. Accès local nourrice accompagné par le gardien. Outillage complet présent.' },
      { kind: 'verification', body: 'Nourrice principale réseau sprinklers : pression 5,8 bars. Plage admissible : 4–6 bars. Vannes d\'isolement secteur nord et sud en position ouverte. Manomètre lisible et calibré.' },
      { kind: 'verification', body: 'Zone A (RDC) — 24 têtes de sprinklers. 23 OK. 1 tête réf. K74 légèrement oxydée mais fonctionnelle — surveillance à J+90 notée au registre.' },
      { kind: 'note',         body: 'Accès faux plafond couloir C nécessite nacelle. Prévu lors du prochain passage (semaine 35) — coordination à valider avec le service maintenance CPS.' },
      { kind: 'verification', body: 'Armoires électriques groupes de mise en pression : disjoncteurs en position fermée, voyants verts. Test de continuité OK. Alimentation ondulée présente et active.' },
      { kind: 'note',         body: 'Félix Katrawi (Élec Plus) contacté pour validation de la coupure électrique zone 3 lors du prochain test alarme complet — confirmé pour le 30/07/2026.' },
      { kind: 'verification', body: 'Zone B (niveau 1) — 31 têtes de sprinklers. 31 conformes. Nettoyage anti-poussière effectué sur 4 têtes en couloir. Aucune anomalie.' },
      { kind: 'verification', body: 'Zone C (niveau 2) — 18 têtes de sprinklers. 18 conformes. Aucune oxydation visible. État général excellent pour une installation de 4 ans.' },
      { kind: 'note',         body: 'Bilan avec Alice Nondas : réseau globalement en bon état. Recommandation : contrôle de pression annuel complet au lieu de semestriel vu la qualité des installations.' },
      { kind: 'verification', body: 'Extincteurs niveau 2 — 2 appareils hors délai remplacés sur place. Étiquettes posées, registre signé. Conformité restaurée sur ce niveau.' },
    ],
    stakeholders: [
      { label: 'Alice Nondas (Calypso)',  role: 'Technicienne sprinklers — vérification complète réseau sprinklers (3h), remplacement extincteurs hors délai, rapport technique remis.' },
      { label: 'Félix Katrawi (Élec Plus)', role: 'Chef d\'équipe électricité — coordination pour coupure zone 3 lors du prochain test alarme complet (30/07/2026).' },
    ],
  },
  {
    key: 'sc2',
    daysBack: 70,
    title: 'Visite de levée de réserves',
    motive: 'levee_reserves',
    objective: 'Visite de suivi des actions correctives',
    outcome: 'a_revoir',
    captures: [
      { kind: 'note',         body: 'Visite de suivi des 5 réserves relevées le 18/04/2026. Objectif : constater la levée totale ou partielle. Équipe : JP Kaémo (CAPSE) et Olivier Meunier (BTP NC).' },
      { kind: 'verification', body: 'Réserve 1 — Issue de secours nord bloquée par mobilier : LEVÉE. Couloir entièrement dégagé. Signalisation remise en place. Point clos.' },
      { kind: 'verification', body: 'Réserve 2 — Extincteur chaufferie hors délai : LEVÉE. Nouvel appareil CO₂ 5kg installé, étiquette mai 2026. Registre signé. Point clos.' },
      { kind: 'note',         body: 'Réserve 3 — Formation évacuation non réalisée : NON LEVÉE. RH CPS confirme report à septembre 2026 (pic d\'activité trimestrielle). Engagement écrit obtenu de Fatima Ouali.' },
      { kind: 'verification', body: 'Réserve 4 — Clapet désenfumage RDC : LEVÉE. Sotraval est intervenu le 24/04/2026. Clapet manœuvré — fermeture étanche. Certificat d\'intervention annexé au registre.' },
      { kind: 'note',         body: 'Réserve 5 — Panneau de sécurité niveau 3 : PARTIELLEMENT LEVÉE. Panneau installé mais lampe de balisage non branchée — câble d\'alimentation manquant. Délai accordé : 15 jours.' },
      { kind: 'note',         body: 'Olivier Meunier (BTP NC) présent pour constater les travaux. Bon d\'intervention Sotraval remis — travaux clapet conformes aux plans. Signature apposée.' },
      { kind: 'verification', body: 'Local TGBT (niveau −1) : accès verrouillé à clé. CO₂ présent. Aucune accumulation de déchets depuis la dernière visite. OK.' },
      { kind: 'verification', body: 'Balisage de sécurité niveau 1 : 8 blocs testés, tous fonctionnels. 1 ampoule remplacée depuis la dernière visite. Amélioration nette.' },
      { kind: 'note',         body: 'M. Beaumont (Directeur CPS) exprime une satisfaction partielle : travaux réalisés rapidement, mais la formation évacuation reste critique à ses yeux. Engagement CAPSE renouvelé.' },
      { kind: 'verification', body: 'Colonnes sèches : revue rapide, pas de changement depuis janvier. Bon état général. Aucune réserve sur ce point.' },
      { kind: 'note',         body: '3e visite de suivi fixée au 09/09/2026 pour constater la levée des 2 réserves restantes. Date confirmée avec le secrétariat CPS.' },
      { kind: 'verification', body: 'Registre de sécurité mis à jour sur place — 2 réserves marquées levées, 2 restantes avec délai. Signatures : JP Kaémo (CAPSE) et M. Beaumont (CPS).' },
    ],
    stakeholders: [
      { label: 'Olivier Meunier (BTP NC)', role: 'Conducteur de travaux — constat des travaux réalisés sur clapet et issues de secours, remise du bon d\'intervention Sotraval.' },
      { label: 'Fatima Ouali (CPS)',        role: 'Responsable sécurité — accompagnement visite, engagement écrit sur formation évacuation septembre 2026.' },
    ],
  },
  {
    key: 'sc3',
    daysBack: 120,
    title: 'Audit initial du site',
    motive: 'inspection',
    objective: 'Audit initial du site',
    outcome: 'non_conforme',
    captures: [
      { kind: 'note',         body: 'Premier passage sur site dans le cadre du nouveau contrat CAPSE-CPS. Objectif : cartographier les équipements et établir la situation de référence. Présence : David Bouvier (CAPSE) + Luc Barnard (SOPAC Sécurité).' },
      { kind: 'verification', body: 'Extincteurs — recensement initial : 38 appareils identifiés sur 4 niveaux. 31 étiquetés. 7 sans étiquette de contrôle — état inconnu. Non-conformité sérieuse, priorité 1.' },
      { kind: 'note',         body: 'Local sprinklers (sous-sol) : accès difficile — porte bloquée par une armoire métallique. Pression nourrice non lisible (manomètre hors de portée). Première anomalie critique identifiée.' },
      { kind: 'verification', body: 'Registre de sécurité : présent, mais incomplet. Dernière signature datée de 14 mois. Aucune trace des 2 contrôles réglementaires annuels exigés. Non-conformité réglementaire.' },
      { kind: 'note',         body: 'Luc Barnard (SOPAC) constate que le système d\'alarme manque d\'un testeur de déclenchement — test complet impossible sans outillage dédié. Rendez-vous prévu à J+7 avec matériel complet.' },
      { kind: 'verification', body: 'Issues de secours : 3 issues identifiées. Issue est (niveau 2) bloquée par des cartons et palettes vides. Obstruction totale — non-conformité critique notifiée immédiatement.' },
      { kind: 'note',         body: 'Local TGBT (niveau −1) : ouvert et sans signalisation de danger. Accumulation de cartons en appui sur l\'armoire principale. Risque incendie et électrique combiné. Alerte transmise sur-le-champ au responsable de site.' },
      { kind: 'verification', body: 'Colonnes sèches : 2 colonnes repérées. 1 bouchon manquant sur la colonne nord. Vannes d\'alimentation non testées — clés non disponibles ce jour.' },
      { kind: 'note',         body: 'Conversation avec M. Beaumont (Directeur CPS) : surpris par le niveau de non-conformité. S\'engage sur une mise en ordre dans les 30 jours. Réunion de bilan planifiée fin du mois.' },
      { kind: 'verification', body: 'Balisage de sécurité : 3 blocs non fonctionnels sur 8 (piles vides ou ampoule défectueuse). 2 panneaux "Sortie de secours" absents aux niveaux 3 et 4.' },
      { kind: 'note',         body: 'Plan d\'actions initial dressé en fin de visite : 8 points dont 3 critiques (issue bloquée, TGBT ouvert, registre incomplet). Transmis à M. Beaumont avant 20h.' },
      { kind: 'note',         body: 'Durée de l\'audit : 4h30. Bâtiment plus complexe qu\'estimé — 4 niveaux + sous-sol technique + local groupe électrogène en toiture. Plan de masse demandé à CPS pour la prochaine visite.' },
      { kind: 'verification', body: 'Groupe électrogène toiture : accès par escalier de service. Dernier test de démarrage : inconnu (aucune trace). Contrat de maintenance groupe à fournir par CPS.' },
      { kind: 'note',         body: 'Bilan avec Luc Barnard (SOPAC) : 11 non-conformités, dont 3 critiques. Score de maturité sécurité estimé à 3/10. Recommandation : contrat annuel avec visite trimestrielle minimum.' },
      { kind: 'verification', body: 'Rapport d\'audit finalisé et signé. Transmis à M. Beaumont par email ce soir même, accusé de réception demandé avant le lendemain 17h.' },
    ],
    stakeholders: [
      { label: 'Luc Barnard (SOPAC Sécurité)', role: 'Agent de sécurité référent — co-inspection lors de l\'audit initial, identification et classification des non-conformités.' },
      { label: 'Fatima Ouali (CPS)',             role: 'Responsable sécurité — présente en fin de visite pour présentation du bilan, engagement sur les actions correctives prioritaires.' },
    ],
  },
  {
    key: 'sc4',
    daysBack: 175,
    title: 'Inspection réglementaire annuelle',
    motive: 'inspection',
    objective: 'Contrôle annuel — systèmes d\'alarme et désenfumage',
    outcome: 'conforme_reserves',
    captures: [
      { kind: 'note',         body: 'Inspection annuelle réglementaire CPS Siège. Équipe CAPSE : Sophie Wané (chef d\'équipe) + Jean-Pierre Kaémo. Représentant CPS : Fatima Ouali.' },
      { kind: 'verification', body: 'Extincteurs — contrôle annuel complet : 35 appareils recensés. 34 conformes, 1 hors délai en niveau 3 — remplacement à J+7. Bon global pour une installation de première année.' },
      { kind: 'verification', body: 'Système alarme incendie — test complet réalisé avec Félix Katrawi (Élec Plus). Toutes les zones déclenchent correctement. Centrale en mode supervision, aucune anomalie en mémoire.' },
      { kind: 'note',         body: 'Félix Katrawi (Élec Plus) réalise les tests alarme et vérifie le câblage de la centrale. Durée : 1h30. Rapport technique remis sur place en fin d\'intervention.' },
      { kind: 'verification', body: 'Désenfumage : 8 clapets testés manuellement. 7 conformes, fermeture étanche. Clapet RDC-B (couloir principal) : temps de fermeture 4s au lieu de 3s max — réserve mineure notée.' },
      { kind: 'verification', body: 'Blocs de balisage de sécurité : 8 blocs testés. 8 fonctionnels. Durée d\'autonomie > 1h sur tous les appareils. Conformes au référentiel.' },
      { kind: 'note',         body: 'Issue de secours niveau 2 : légère déformation du dormant constatée — la porte frotte en bas lors de la fermeture mais reste opérationnelle. Surveillance recommandée.' },
      { kind: 'verification', body: 'Registre de sécurité : à jour, toutes les colonnes renseignées. Signatures présentes pour les 4 contrôles réglementaires de l\'année. Conforme.' },
      { kind: 'verification', body: 'Groupe électrogène toiture : test de démarrage automatique réalisé. Démarrage en 8s. Charge réseau partielle appliquée 15 min. Groupe fonctionnel, niveaux huile et carburant OK.' },
      { kind: 'note',         body: 'Bilan avec Fatima Ouali : nette amélioration par rapport au dernier audit. Elle confirme que les équipes ont intégré les consignes de rangement et de maintenance préventive.' },
      { kind: 'verification', body: 'Rapport annuel signé par les 3 parties (CAPSE, CPS, Élec Plus). Transmis à la DDTM pour archivage réglementaire. Attestation de conformité délivrée.' },
    ],
    stakeholders: [
      { label: 'Félix Katrawi (Élec Plus)', role: 'Chef d\'équipe électricité — tests alarme et vérification câblage centrale, rapport technique fourni et signé.' },
      { label: 'Fatima Ouali (CPS)',         role: 'Responsable sécurité CPS — accompagnement inspection annuelle réglementaire, bilan final satisfaisant.' },
    ],
  },
]

const SHOWCASE_MEETINGS = [
  {
    key: 'sc-m0',
    daysBack: 7,
    title: 'Point d\'urgence — anomalie désenfumage CPS Siège',
    participants: [
      { name: 'David Bouvier',    role: 'Directeur technique CAPSE',          kind: 'person', presence: 'P'  },
      { name: 'Marc Rodriguez',   role: 'Responsable technique Clim Expair',  kind: 'person', presence: 'P'  },
      { name: 'Fatima Ouali',     role: 'Responsable sécurité CPS',           kind: 'person', presence: 'P'  },
      { name: 'Jean-Pierre Kaémo', role: 'Chef équipe inspection CAPSE',      kind: 'person', presence: 'P'  },
    ],
    decisions: [
      'Déclenchement immédiat d\'une intervention Sotraval sur clapet CB-04 (couloir B sous-sol) — délai max 48h',
      'Restriction d\'accès au couloir B jusqu\'à confirmation de remise en état par CAPSE',
      'Point de suivi fixé au 05/08/2026 pour constater la levée de la non-conformité',
    ],
    summary: 'Réunion d\'urgence déclenchée suite à la détection d\'une anomalie sur le clapet de désenfumage CB-04 lors de l\'inspection du 22/07/2026. Décision prise de traiter la non-conformité en priorité 1 avec intervention Sotraval sous 48h. Couloir B mis en restriction d\'accès. Prochaine réunion de suivi le 05/08/2026.',
  },
  {
    key: 'sc-m1',
    daysBack: 32,
    title: 'Réunion de suivi mensuelle — CPS Quartier Latin',
    participants: [
      { name: 'David Bouvier',   role: 'Directeur technique CAPSE',           kind: 'person', presence: 'P'  },
      { name: 'Marie Lefèvre',   role: 'Responsable Audit & Conformité CAPSE', kind: 'person', presence: 'P'  },
      { name: 'M. Beaumont',     role: 'Directeur CPS',                       kind: 'person', presence: 'P'  },
      { name: 'Fatima Ouali',    role: 'Responsable sécurité CPS',            kind: 'person', presence: 'P'  },
      { name: 'Alice Nondas',    role: 'Technicienne sprinklers Calypso',     kind: 'person', presence: 'AE' },
    ],
    decisions: [
      'Renouvellement contrat maintenance extincteurs Calypso pour l\'exercice 2027 — bon pour accord CPS',
      'Formation évacuation planifiée pour le 09/09/2026 avec participation de 60 collaborateurs CPS',
      'Budget complémentaire de 85 000 XPF accordé pour la mise en conformité du panneau niveau 3 et câblage balisage',
    ],
    summary: 'Réunion mensuelle de suivi du contrat CAPSE-CPS. Revue des 5 réserves ouvertes : 3 levées, 2 en cours de traitement. Budget complémentaire accordé pour finaliser la mise en conformité. Exercice évacuation planifié le 09/09/2026. Renouvellement contrat extincteurs Calypso validé à l\'unanimité.',
  },
  {
    key: 'sc-m2',
    daysBack: 90,
    title: 'Bilan trimestriel de sécurité — CPS',
    participants: [
      { name: 'David Bouvier',    role: 'Directeur technique CAPSE',         kind: 'person', presence: 'P'  },
      { name: 'Jean-Pierre Kaémo', role: 'Chef équipe inspection CAPSE',     kind: 'person', presence: 'P'  },
      { name: 'M. Beaumont',      role: 'Directeur CPS',                     kind: 'person', presence: 'P'  },
      { name: 'Fatima Ouali',     role: 'Responsable sécurité CPS',          kind: 'person', presence: 'P'  },
      { name: 'Thierry Paoua',    role: 'Conducteur de travaux Sotraval',    kind: 'person', presence: 'AE' },
    ],
    decisions: [
      'Mandater Sotraval pour remise en conformité complète des colonnes sèches — devis à fournir sous 15 jours',
      'Programmer la vérification du groupe électrogène toiture lors de la prochaine inspection CAPSE (juillet 2026)',
      'Transmettre le rapport trimestriel de sécurité à la direction générale CPS avant fin de mois',
    ],
    summary: 'Bilan trimestriel réunissant CAPSE et la direction CPS. Revue complète des non-conformités relevées lors de l\'audit initial : 11 points, 8 résolus, 3 en cours. Plan de mise en conformité validé, budget approuvé pour Sotraval. Prochain bilan trimestriel prévu en octobre 2026.',
  },
]

const TENDER_CPS_TEXT = `CAHIER DES CHARGES — APPEL D'OFFRES

MAINTENANCE ET CONTRÔLE DES INSTALLATIONS DE SÉCURITÉ INCENDIE
CPS SIÈGE SOCIAL — QUARTIER LATIN, NOUMÉA

Référence : CPS-SI-2026-018 | Date limite de remise des offres : 15 septembre 2026

1. PRÉSENTATION DU MAÎTRE D'OUVRAGE
La Caisse de Protection Sociale (CPS) est l'organisme de protection sociale de Nouvelle-Calédonie, dont le siège social est situé au Quartier Latin à Nouméa. L'établissement comprend 4 niveaux de bureaux et un sous-sol technique, pour une surface totale de 4 200 m². L'effectif permanent est de 220 agents.

2. OBJET DU MARCHÉ
Le présent appel d'offres porte sur la maintenance préventive et corrective, ainsi que les contrôles réglementaires annuels, de l'ensemble des installations de sécurité incendie du siège social CPS. Durée du marché : 2 ans, renouvelables une fois.

3. PÉRIMÈTRE DES PRESTATIONS
- Extincteurs (38 appareils) : contrôle semestriel, remplacement selon état
- Réseau sprinklers : contrôle de pression trimestriel, vérification des têtes annuelle
- Système alarme incendie (centrale ZX5, 4 zones) : test complet semestriel
- Désenfumage (8 clapets) : test annuel et maintenance préventive
- Colonnes sèches (2) : vérification annuelle
- Balisage de sécurité (8 blocs) : remplacement piles/ampoules
- Registre de sécurité : mise à jour après chaque intervention

4. EXIGENCES TECHNIQUES
- Titulaire certifié APSAD ou équivalent pour extincteurs et sprinklers
- Habilitations électriques BR et B2V pour travaux sur centrale alarme
- Délai d'intervention urgente : 4h maximum en jours ouvrés
- Rapport d'intervention numérique transmis sous 48h
- Accès 24h/24 à une hotline technique dédiée

5. CRITÈRES D'ÉVALUATION
- Prix (40%) : décomposition par poste de prestation
- Références techniques en Nouvelle-Calédonie (25%) : au moins 3 sites comparables dans les 3 ans
- Délai d'intervention et organisation (20%)
- Qualité de l'outillage et des équipements (15%)
`

const TENDER_SMSP_TEXT = `APPEL D'OFFRES — SMSP TOWER
MAINTENANCE PRÉVENTIVE SÉCURITÉ INCENDIE 2027

Référence : SMSP-MAINT-2026-005 | Date de clôture : 30 août 2026

CONTEXTE
La tour SMSP (8 étages, 6 200 m², 180 occupants permanents) recherche un prestataire pour la maintenance complète de ses installations de sécurité incendie à compter du 1er janvier 2027. Le contrat actuel (SOPAC Sécurité) arrive à échéance le 31/12/2026.

PÉRIMÈTRE
Extincteurs, colonnes sèches, désenfumage mécanique (moteurs de toiture), alarme incendie (centrale Notifier), balisage de sécurité, registre réglementaire.

SPÉCIFICITÉS DU SITE
- Tour de bureaux, occupation en journée uniquement (7h–20h)
- Accès parking sous-sol : badgeage obligatoire
- Local central sécurité au rez-de-chaussée : accès 24h/24
- Moteurs de désenfumage en toiture : habilitation travaux en hauteur exigée

BUDGET INDICATIF
L'enveloppe annuelle indicative est de 2 800 000 XPF.

CRITÈRES DE SÉLECTION
Expérience sur bâtiments en hauteur, connaissance des systèmes Notifier, délai de réponse, prix.
`

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
  // Purge préalable : les rôles dépendent de l'index si → changer le tableau SITES
  // peut modifier les assignments. On repart d'une table propre pour les sites courants.
  const currentSiteIds = SITES.map(s => `'${duid('site:' + s.key)}'`).join(',')
  await runSql(`DELETE FROM public.site_intervenants WHERE site_id IN (${currentSiteIds})`)
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
  console.log(`  Missions & interventions (${SITES.length} sites × 2 missions × 7 interventions)…`)
  const adminId = authIds['david.bouvier']

  const missionRows: string[] = []
  const interventionRows: string[] = []

  const missionDefs = [
    { suffix: 'm0', name: 'Inspection mensuelle sécurité incendie', cadence: 'monthly' },
    { suffix: 'm1', name: 'Contrôle extincteurs & sprinklers', cadence: 'on_demand' },
  ] as const

  // TODAY = 2026-07-29 (mercredi). Lundi de chaque semaine cible (offset depuis TODAY) :
  //   -93 = lundi il y a ~13 semaines | -65 = ~9 sem. | -37 = ~5 sem. | -9 = semaine passée
  //   -2  = cette semaine | +5 = semaine prochaine | +33 = dans 5 semaines
  // Chaque site reçoit un weekday dédié (si % 5 → 0=lun … 4=ven) → 5-7 interventions/jour max.
  const intSchedule = [
    { mondayBase: -93, status: 'completed' },
    { mondayBase: -65, status: 'completed' },
    { mondayBase: -37, status: 'completed' },
    { mondayBase: -9,  status: 'completed' },
    { mondayBase: -2,  status: 'planned'   }, // cette semaine
    { mondayBase:  5,  status: 'planned'   }, // semaine prochaine
    { mondayBase: 33,  status: 'planned'   }, // dans 5 semaines
  ] as const

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId   = duid('site:' + site.key)
    const teamId   = duid(TEAMS[si % 3].key)
    const weekday  = si % 5          // 0=lun, 1=mar, 2=mer, 3=jeu, 4=ven — constant par site

    for (const md of missionDefs) {
      const missionId  = duid(`mission:${site.key}:${md.suffix}`)
      const startHour  = md.suffix === 'm0' ? 8 : 13  // inspection matin, extincteurs aprèm
      missionRows.push(`(
        '${missionId}', '${siteId}', ${esc(md.name)},
        '${md.cadence}'::mission_cadence, true, '${ORG_ID}', '${adminId}'
      )`)

      for (let ii = 0; ii < intSchedule.length; ii++) {
        const { mondayBase, status } = intSchedule[ii]
        const intId      = duid(`int:${site.key}:${md.suffix}:${ii}`)
        const scheduledAt = addDays(TODAY_STR, mondayBase + weekday)
        scheduledAt.setHours(startHour, 0, 0, 0)
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
      ON CONFLICT (id) DO UPDATE SET
        scheduled_at    = EXCLUDED.scheduled_at,
        scheduled_for   = EXCLUDED.scheduled_for,
        status          = EXCLUDED.status,
        assigned_team_id = EXCLUDED.assigned_team_id
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${interventionRows.length} interventions\n`)
}

async function seedSiteActions(authIds: Record<string, string>) {
  console.log('  Actions par chantier (mix done / late / upcoming / planned)…')
  const adminId = authIds['david.bouvier']
  const rows: string[] = []

  // Statuts et dates par index d'action
  // convertedType/convertedId : lie l'action à une mission pour l'écran intervention
  const ACTION_VARIANTS = [
    // ai=0 : terminée il y a ~2 mois
    { status: 'done',    dueDaysOffset: -60, doneDaysOffset: -55, convertedSuffix: null },
    // ai=1 : ouverte EN RETARD (due passée) — liée à mission m0
    { status: 'open',    dueDaysOffset: -15, doneDaysOffset: null, convertedSuffix: 'm0' },
    // ai=2 : ouverte, échéance à venir — liée à mission m1
    { status: 'open',    dueDaysOffset:  21, doneDaysOffset: null, convertedSuffix: 'm1' },
    // ai=3 : planifiée
    { status: 'planned', dueDaysOffset:  35, doneDaysOffset: null, convertedSuffix: null },
  ] as const

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId = duid('site:' + site.key)
    const reportId = duid(`rp:${site.key}:v0`)
    const count = 3 + (si % 2)

    for (let ai = 0; ai < count; ai++) {
      const action = pick(ACTION_POOL, `sa:${site.key}:${ai}`)
      const aId = duid(`sa:${site.key}:${ai}`)
      const variant = ACTION_VARIANTS[ai % ACTION_VARIANTS.length]
      const dueDate = isoDate(addDays(TODAY_STR, variant.dueDaysOffset))
      const doneAt = variant.doneDaysOffset !== null
        ? esc(pgTs(addDays(TODAY_STR, variant.doneDaysOffset)))
        : 'NULL'
      const convType = variant.convertedSuffix ? `'mission'` : 'NULL'
      const convId   = variant.convertedSuffix ? `'${duid('mission:' + site.key + ':' + variant.convertedSuffix)}'` : 'NULL'

      rows.push(`(
        '${aId}', '${siteId}', '${reportId}',
        ${esc(action.title)}, ${esc(action.rationale)},
        'Sécurité incendie', ${esc(action.owner)},
        '${variant.status}', '${dueDate}', ${doneAt}, '${adminId}',
        ${convType}, ${convId}
      )`)
    }
  }

  for (let i = 0; i < rows.length; i += 50) {
    await runSql(`
      INSERT INTO public.site_actions
        (id, site_id, report_id, title, body, corps_etat, assigned_to, status, due_date, done_at, created_by,
         converted_to_type, converted_to_id)
      VALUES ${rows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO UPDATE SET
        status            = EXCLUDED.status,
        due_date          = EXCLUDED.due_date,
        done_at           = EXCLUDED.done_at,
        converted_to_type = EXCLUDED.converted_to_type,
        converted_to_id   = EXCLUDED.converted_to_id
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${rows.length} actions (done/late/upcoming/planned)\n`)
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

async function seedPlanningCycles(authIds: Record<string, string>) {
  console.log(`  Roulements (planning_cycles + slots) — ${SITES.length} sites × 2 missions…`)
  const adminId = authIds['david.bouvier']
  // Pré-purge : les weekdays/teams dépendent de l'index si → repart proprement
  const currentSiteIds = SITES.map(s => `'${duid('site:' + s.key)}'`).join(',')
  await runSql(`
    DELETE FROM public.planning_cycle_slots
    WHERE cycle_id IN (SELECT id FROM public.planning_cycles WHERE site_id IN (${currentSiteIds}))
  `)
  await runSql(`DELETE FROM public.planning_cycles WHERE site_id IN (${currentSiteIds})`)
  const anchorDate = '2026-07-27' // lundi de la semaine courante
  const startsOn  = '2026-01-05' // début d'année, lundi

  const cycleRows: string[] = []
  const slotRows:  string[] = []

  // 2 roulements par site : mensuel (4 sem.) le lundi matin, bi-hebdo (2 sem.) le jeudi aprèm
  const cycleDefs = [
    { suffix: 'm0', label: 'Inspection mensuelle — roulement', cycleWeeks: 4, weekday: 1, t0: '08:00', t1: '12:00' },
    { suffix: 'm1', label: 'Contrôle extincteurs — roulement',  cycleWeeks: 2, weekday: 4, t0: '13:00', t1: '16:30' },
  ] as const

  for (let si = 0; si < SITES.length; si++) {
    const site = SITES[si]
    const siteId   = duid('site:' + site.key)
    // Inspection Nord pour sites pairs, Inspection Sud pour sites impairs
    const teamId   = duid(TEAMS[si % 2].key)

    for (const cd of cycleDefs) {
      const missionId = duid(`mission:${site.key}:${cd.suffix}`)
      const cycleId   = duid(`cycle:${site.key}:${cd.suffix}`)
      cycleRows.push(`(
        '${cycleId}', '${ORG_ID}', '${siteId}', '${missionId}',
        ${esc(site.name + ' — ' + cd.label)},
        ${cd.cycleWeeks}, '${anchorDate}', '${startsOn}', NULL,
        'published', '${adminId}'
      )`)
      slotRows.push(`(
        '${duid('slot:' + site.key + ':' + cd.suffix)}',
        '${cycleId}', 0, ${cd.weekday}, '${teamId}',
        'work', '${cd.t0}', '${cd.t1}'
      )`)
    }
  }

  for (let i = 0; i < cycleRows.length; i += 50) {
    await runSql(`
      INSERT INTO public.planning_cycles
        (id, organization_id, site_id, mission_id, name,
         cycle_length_weeks, anchor_date, starts_on, ends_on,
         status, created_by)
      VALUES ${cycleRows.slice(i, i + 50).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
    process.stdout.write('.')
  }
  for (let i = 0; i < slotRows.length; i += 50) {
    await runSql(`
      INSERT INTO public.planning_cycle_slots
        (id, cycle_id, week_index, weekday, team_id, state, start_time, end_time)
      VALUES ${slotRows.slice(i, i + 50).join(',')}
      ON CONFLICT (cycle_id, week_index, weekday, team_id) DO NOTHING
    `)
    process.stdout.write('.')
  }
  console.log()
  process.stdout.write(`    ${cycleRows.length} roulements published, ${slotRows.length} cases\n`)
}

// ════════════════════════════════════════════════════════════════════════════════
// SHOWCASE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

async function seedShowcaseSite(authIds: Record<string, string>) {
  console.log(`  Showcase CPS Siège — ${SHOWCASE_VISITS.length} visites riches + captures + intervenants…`)
  const adminId = authIds['david.bouvier']
  const siteId = duid('site:' + SHOWCASE_SITE_KEY)

  // 1. Site reports pour les visites showcase
  const reportRows: string[] = []
  for (const sv of SHOWCASE_VISITS) {
    const rid = duid(`rp:${SHOWCASE_SITE_KEY}:${sv.key}`)
    const startedAt = addDays(TODAY_STR, -sv.daysBack)
    const endedAt = new Date(startedAt.getTime() + 2.5 * 3600 * 1000)
    const analysis = makeDebriefAnalysis(`${SHOWCASE_SITE_KEY}:${sv.key}`, 0, startedAt, sv.outcome)
    reportRows.push(`(
      '${rid}', '${siteId}', '${ORG_ID}', '${ORG_ID}',
      'curated', 'done', 'planned',
      ${esc(pgTs(startedAt))}, ${esc(pgTs(endedAt))},
      ${esc(sv.title)}, ${esc(sv.motive)}, ${esc(sv.objective)}, '${sv.outcome}',
      ${escJson(analysis)},
      '${adminId}',
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
    VALUES ${reportRows.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)

  // 2. Captures riches (12-15 par visite)
  const captureRows: string[] = []
  for (const sv of SHOWCASE_VISITS) {
    const rid = duid(`rp:${SHOWCASE_SITE_KEY}:${sv.key}`)
    for (let c = 0; c < sv.captures.length; c++) {
      const cap = sv.captures[c]
      captureRows.push(`(
        '${duid('vc:' + SHOWCASE_SITE_KEY + ':' + sv.key + ':' + c)}',
        '${ORG_ID}', '${siteId}', '${rid}',
        '${cap.kind}', 'processed',
        ${esc(cap.body)}, '${adminId}'
      )`)
    }
  }
  for (let i = 0; i < captureRows.length; i += 100) {
    await runSql(`
      INSERT INTO public.visit_capture
        (id, organization_id, site_id, report_id, kind, status, body, created_by)
      VALUES ${captureRows.slice(i, i + 100).join(',')}
      ON CONFLICT (id) DO NOTHING
    `)
  }

  // 3. Proposals kind='stakeholder' (pour l'onglet "Intervenants" du détail visite)
  const propRows: string[] = []
  for (const sv of SHOWCASE_VISITS) {
    const rid = duid(`rp:${SHOWCASE_SITE_KEY}:${sv.key}`)
    for (let s = 0; s < sv.stakeholders.length; s++) {
      const sh = sv.stakeholders[s]
      const pid = duid(`prop:${SHOWCASE_SITE_KEY}:${sv.key}:sh:${s}`)
      const dedupeKey = `${SEED_KEY}:${SHOWCASE_SITE_KEY}:${sv.key}:sh:${s}`
      propRows.push(`(
        '${pid}', '${ORG_ID}', '${siteId}', '${rid}',
        1, 'stakeholder', 'confirmed',
        ${esc(sh.label)}, ${esc(sh.role)},
        '{}', NULL, '{}',
        ${esc(dedupeKey)}
      )`)
    }
  }
  await runSql(`
    INSERT INTO public.site_knowledge_proposals
      (id, organization_id, site_id, report_id, analysis_version,
       kind, status, title, body, payload, confidence, source_capture_ids, dedupe_key)
    VALUES ${propRows.join(',')}
    ON CONFLICT (site_id, dedupe_key) DO NOTHING
  `)

  const totalCaptures = SHOWCASE_VISITS.reduce((s, v) => s + v.captures.length, 0)
  const totalStakeholders = SHOWCASE_VISITS.reduce((s, v) => s + v.stakeholders.length, 0)
  process.stdout.write(`    ${SHOWCASE_VISITS.length} visites, ${totalCaptures} captures, ${totalStakeholders} intervenants\n`)
}

async function seedShowcaseMeetings(authIds: Record<string, string>) {
  console.log(`  Showcase réunions CPS Siège — participants + comptes rendus IA…`)
  const adminId = authIds['david.bouvier']
  const siteId = duid('site:' + SHOWCASE_SITE_KEY)

  // Enrichir les réunions génériques cps-siege avec des participants (UPDATE direct)
  const genericEnrichments = [
    {
      id: duid(`rp:${SHOWCASE_SITE_KEY}:m0`),
      participants: [
        { name: 'David Bouvier', role: 'Directeur technique CAPSE', kind: 'person', presence: 'P'  },
        { name: 'M. Beaumont',   role: 'Directeur CPS',             kind: 'person', presence: 'P'  },
        { name: 'Fatima Ouali',  role: 'Responsable sécurité CPS',  kind: 'person', presence: 'P'  },
      ],
    },
    {
      id: duid(`rp:${SHOWCASE_SITE_KEY}:m1`),
      participants: [
        { name: 'David Bouvier', role: 'Directeur technique CAPSE',           kind: 'person', presence: 'P'  },
        { name: 'Marie Lefèvre', role: 'Responsable Audit & Conformité CAPSE', kind: 'person', presence: 'P'  },
        { name: 'M. Beaumont',   role: 'Directeur CPS',                       kind: 'person', presence: 'AE' },
        { name: 'Fatima Ouali',  role: 'Responsable sécurité CPS',            kind: 'person', presence: 'P'  },
      ],
    },
  ]
  for (const gm of genericEnrichments) {
    await runSql(`
      UPDATE public.site_reports
      SET participants = ${escJson(gm.participants)}::jsonb
      WHERE id = '${gm.id}'
    `)
  }

  // Nouvelles réunions showcase avec participants + debrief_analysis
  const rows: string[] = []
  for (const sm of SHOWCASE_MEETINGS) {
    const rid = duid(`rp:${SHOWCASE_SITE_KEY}:${sm.key}`)
    const startedAt = addDays(TODAY_STR, -sm.daysBack)
    const debriefAnalysis = {
      summary: sm.summary,
      decisions: sm.decisions,
      actions: [],
      watchpoints: [],
      a_savoir: [],
      echeances: [],
      intervenants: sm.participants.filter((p: { presence: string }) => p.presence === 'P').map((p: { name: string }) => p.name),
      attention: [],
      open_questions: [],
      forgotten_obligations: [],
      objective: sm.title,
      objective_rationale: 'Réunion de coordination CAPSE-CPS.',
      objective_confidence: 'elevee',
      subject_match_index: -1,
      subject_name: '',
      subject_rationale: '',
      subject_confidence: null,
      outcome: 'conforme',
      resolution: null,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      generated_at: new Date(startedAt.getTime() + 1.5 * 3600 * 1000).toISOString(),
      corpus_hash: crypto.createHash('sha256').update(`${SEED_KEY}:${sm.key}`).digest('hex').slice(0, 16),
      schema_version: 'v7-echeances-ancrees',
      analysis_version: 1,
      source_snapshot: { photos: 0, videos: 0, vocals: 0, notes: 0, last_capture_at: null },
      action_ledger: [],
    }
    rows.push(`(
      '${rid}', '${siteId}', '${ORG_ID}', '${ORG_ID}',
      'curated', 'none', NULL,
      ${esc(pgTs(startedAt))}, NULL,
      ${esc(sm.title)}, NULL, NULL, NULL,
      ${escJson(debriefAnalysis)},
      ${escJson(sm.participants)},
      '${adminId}',
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
       participants,
       created_by, created_at)
    VALUES ${rows.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)
  process.stdout.write(`    ${SHOWCASE_MEETINGS.length} réunions créées, 2 réunions génériques enrichies\n`)
}

async function seedTeamFieldMembers(authIds: Record<string, string>) {
  console.log('  Personnes actives (team_field_members)…')
  const adminId = authIds['david.bouvier']
  const joinedAt = pgTs(addDays(TODAY_STR, -180))
  const links = [
    { key: 'tfm:marc-rodriguez:insp-nord',  teamKey: 'team:insp-nord', contactKey: 'cc:marc-rodriguez' },
    { key: 'tfm:alice-nondas:insp-nord',    teamKey: 'team:insp-nord', contactKey: 'cc:alice-nondas'   },
    { key: 'tfm:luc-barnard:insp-sud',      teamKey: 'team:insp-sud',  contactKey: 'cc:luc-barnard'    },
    { key: 'tfm:thierry-paoua:insp-sud',    teamKey: 'team:insp-sud',  contactKey: 'cc:thierry-paoua'  },
    { key: 'tfm:felix-katrawi:audit',       teamKey: 'team:audit',     contactKey: 'cc:felix-katrawi'  },
  ]
  const rows = links.map(l => `(
    '${duid(l.key)}', '${ORG_ID}', '${duid(l.teamKey)}', '${duid(l.contactKey)}',
    ${esc(joinedAt)}, NULL, '${adminId}'
  )`)
  await runSql(`
    INSERT INTO public.team_field_members (id, organization_id, team_id, contact_id, joined_at, left_at, created_by)
    VALUES ${rows.join(',')}
    ON CONFLICT (id) DO NOTHING
  `)
  process.stdout.write(`    ${links.length} personnes actives liées aux équipes\n`)
}

async function seedTenders(authIds: Record<string, string>) {
  console.log('  Appels d\'offres (AO)…')
  const adminId = authIds['david.bouvier']

  const TENDERS_DATA = [
    {
      key:        'tender:cps-2026',
      title:      'AO — Sécurité incendie CPS Siège social 2026–2028',
      clientName: 'CPS – Caisse de Protection Sociale',
      deadline:   '2026-09-15',
      text:       TENDER_CPS_TEXT,
      filename:   'CPS_SI_2026_018_cahier_des_charges.pdf',
      analysis: {
        summary:      'AO de maintenance incendie sur 2 ans pour le siège CPS (4 200 m², 220 agents, 38 extincteurs, réseau sprinklers ZX5). Périmètre 7 types d\'équipements, critères prix 40 % + références NC 25 %. Budget estimé 3,5–5M XPF/an. Opportunité stratégique : CPS est une référence institutionnelle forte en Nouvelle-Calédonie. CAPSE dispose déjà d\'un historique de 6 mois sur site.',
        constraints:  [
          { text: 'Certification APSAD ou équivalent obligatoire',               priority: 'bloquant'  },
          { text: 'Délai d\'intervention urgente < 4h en jours ouvrés',          priority: 'bloquant'  },
          { text: 'Habilitation BR et B2V pour travaux sur centrale alarme',     priority: 'bloquant'  },
          { text: 'Rapport numérique transmis sous 48h après chaque passage',    priority: 'important' },
          { text: 'Hotline 24h/24 — ressource humaine dédiée à prévoir',         priority: 'important' },
        ],
        risks: [
          { text: 'Accès au sous-sol technique limité aux horaires de bureau — contrainte logistique',  severity: 'moyen'  },
          { text: 'Réseau sprinklers vieillissant — coûts pièces détachées potentiellement élevés',     severity: 'moyen'  },
          { text: 'Concurrence probable avec SOPAC Sécurité et Calypso Extincteurs sur ce site',        severity: 'moyen'  },
          { text: 'Évolution réglementaire (code de la construction NC) — veille à maintenir',          severity: 'faible' },
        ],
        checklist: [
          { label: 'Certification APSAD vérifiée et à jour',                          done: true  },
          { label: 'Habilitations électriques BR + B2V disponibles dans l\'équipe',   done: true  },
          { label: 'Référence de 3 sites comparables en NC à joindre',                done: false },
          { label: 'Offre de prix décomposée sur les 5 postes demandés',              done: false },
          { label: 'Assurance RC Pro à jour et jointe au dossier de candidature',     done: false },
          { label: 'Planning de maintenance annuelle proposé en annexe technique',    done: false },
        ],
        technical_memo: 'Approche recommandée : contrat avec visite trimestrielle systématique et tableau de bord CAPSE mensuel. Valoriser la connaissance du site (audit initial mars 2026, 11 non-conformités traitées, relation établie avec Fatima Ouali). Prix cible : 420 000 XPF/mois tout inclus, soit 5,04M XPF/an — compétitif vs. SOPAC qui facture les passages séparément.',
      },
    },
    {
      key:        'tender:smsp-2027',
      title:      'AO — Maintenance préventive équipements SMSP Tower 2027',
      clientName: 'SMSP Tower',
      deadline:   '2026-08-30',
      text:       TENDER_SMSP_TEXT,
      filename:   'SMSP_MAINT_2026_005_appel_offres.pdf',
      analysis: {
        summary:      'AO remplacement contrat SOPAC Sécurité sur tour SMSP (8 étages, 6 200 m²). Budget indicatif 2,8M XPF/an, démarrage 01/01/2027. Spécificité : moteurs désenfumage toiture (habilitation hauteur) + centrale Notifier (vs ZX5 chez CPS). Délai de réponse très court (30/08/2026). Opportunité de déloger SOPAC sur un site où CAPSE est déjà présent en inspection.',
        constraints:  [
          { text: 'Habilitation travaux en hauteur pour moteurs de désenfumage toiture', priority: 'bloquant'  },
          { text: 'Maîtrise de la centrale Notifier (différente des ZX5 habituels)',      priority: 'important' },
          { text: 'Badgeage obligatoire pour accès parking sous-sol — coordination CPS',  priority: 'moyen'    },
          { text: 'Clôture de l\'AO le 30/08/2026 — délai très court (< 5 semaines)',    priority: 'important' },
        ],
        risks: [
          { text: 'Centrale Notifier peu maîtrisée dans l\'équipe — formation ou sous-traitance à prévoir',     severity: 'moyen' },
          { text: 'SOPAC Sécurité pourrait proposer un prix très bas pour conserver le contrat sortant',        severity: 'élevé' },
          { text: 'Démarrage 01/01/2027 — transition de 2 mois si signature en octobre, très serré',            severity: 'faible' },
        ],
        checklist: [
          { label: 'Habilitation travaux en hauteur vérifiée dans l\'équipe',            done: false },
          { label: 'Formation ou partenaire sur centrale Notifier identifié',            done: false },
          { label: 'Prix ajusté en dessous des 2,8M XPF indicatif pour être compétitif', done: false },
          { label: 'Offre transmise avant le 30/08/2026 à 17h',                          done: false },
          { label: 'Référence de bâtiment en hauteur en NC jointe au dossier',          done: false },
        ],
        technical_memo: 'Opportunité à saisir rapidement. Angle : CAPSE inspecte déjà SMSP Tower (plateaux 3e et 8e, missions actives). Proposer une continuité inspection/maintenance pour réduire les frictions administratives côté SMSP. Prix cible : 2,4M XPF/an (−14 % vs budget indicatif). Mobiliser l\'équipe Inspection Sud (Patrick Djirilet) pour la présentation technique.',
      },
    },
  ]

  for (const td of TENDERS_DATA) {
    const tenderId = duid(td.key)
    await runSql(`
      INSERT INTO public.tenders (id, title, client_name, deadline, status, created_by, organization_id)
      VALUES (
        '${tenderId}',
        ${esc(td.title)},
        ${esc(td.clientName)},
        '${td.deadline}',
        'ready',
        '${adminId}',
        '${ORG_ID}'
      )
      ON CONFLICT (id) DO NOTHING
    `)
    const docId = duid(td.key + ':doc0')
    await runSql(`
      INSERT INTO public.tender_documents (id, tender_id, storage_path, filename, size_bytes, page_count, extracted_text)
      VALUES (
        '${docId}', '${tenderId}',
        ${esc('demo-capse/' + td.key.replace('tender:', '') + '/document.pdf')},
        ${esc(td.filename)},
        ${Math.floor(td.text.length * 1.3)},
        4,
        ${esc(td.text)}
      )
      ON CONFLICT (id) DO NOTHING
    `)
    const analysisId = duid(td.key + ':analysis0')
    await runSql(`
      INSERT INTO public.tender_analyses
        (id, tender_id, provider, model, summary, constraints, risks, checklist, technical_memo)
      VALUES (
        '${analysisId}', '${tenderId}',
        'anthropic', 'claude-opus-4-8',
        ${esc(td.analysis.summary)},
        ${escJson(td.analysis.constraints)},
        ${escJson(td.analysis.risks)},
        ${escJson(td.analysis.checklist)},
        ${esc(td.analysis.technical_memo)}
      )
      ON CONFLICT (id) DO NOTHING
    `)
  }
  process.stdout.write(`    ${TENDERS_DATA.length} AO avec documents et analyses IA\n`)
}

// ════════════════════════════════════════════════════════════════════════════════
// PURGE — supprime les sites retirés du seed (anciens sites hors liste SITES)
// ════════════════════════════════════════════════════════════════════════════════

async function purgeRemovedSites() {
  // Sites présents dans l'ancienne version du seed (34 sites) mais absents de SITES (6 sites).
  // Protégé par is_demo = true côté seedOrg — refuse de s'exécuter sur une orga réelle.
  const REMOVED_SITE_KEYS = [
    'pacific-doniambo', 'pacific-hangar', 'pacific-labo',
    'hilton-technique', 'hilton-piscine',
    'dumbea-parking', 'dumbea-local-tech', 'dumbea-mairie', 'dumbea-sport',
    'garnier-principal', 'garnier-internat', 'garnier-cuisine',
    'port-terminal', 'port-frigo',
    'total-montravel', 'total-dumbea',
    'ballande-entrepot-a', 'ballande-entrepot-b',
    'kuindo-bloc', 'kuindo-urgences',
    'vale-fonderie', 'vale-traitement',
    'casino-jeux', 'casino-machines',
    'prony-mine', 'prony-usine',
    'aircalin-maintenance', 'aircalin-bureaux',
  ]

  const REMOVED_CLIENT_KEYS = [
    'pacific-industries', 'ville-dumbea', 'lycee-garnier', 'port-nc',
    'totalenergies-nc', 'ballande-logistique', 'clinique-kuindo',
    'vale-nc', 'casino-noumea', 'prony-resources', 'aircalin',
  ]

  const siteIds = REMOVED_SITE_KEYS.map(k => `'${duid('site:' + k)}'`).join(',')
  const clientIds = REMOVED_CLIENT_KEYS.map(k => `'${duid('client:' + k)}'`).join(',')

  const rows = await runSql(`
    SELECT COUNT(*) AS n FROM public.sites WHERE id IN (${siteIds})
  `) as Array<{ n: string }>
  const count = parseInt(rows[0]?.n ?? '0', 10)
  if (count === 0) {
    console.log('  Purge : aucun ancien site à supprimer.')
    return
  }
  console.log(`  Purge : ${count} anciens sites à supprimer…`)

  // 1) interventions → missions (ON DELETE RESTRICT sur missions.site_id)
  await runSql(`
    DELETE FROM public.interventions
    WHERE mission_id IN (
      SELECT id FROM public.missions WHERE site_id IN (${siteIds})
    )
  `)
  // 2) planning_cycle_slots → planning_cycles
  await runSql(`
    DELETE FROM public.planning_cycle_slots
    WHERE cycle_id IN (
      SELECT id FROM public.planning_cycles WHERE site_id IN (${siteIds})
    )
  `)
  await runSql(`DELETE FROM public.planning_cycles WHERE site_id IN (${siteIds})`)
  // 3) missions (RESTRICT levé une fois les interventions supprimées)
  await runSql(`DELETE FROM public.missions WHERE site_id IN (${siteIds})`)
  // 4) sites — cascade : site_reports, visit_capture, site_knowledge_proposals,
  //                      site_actions, site_intervenants, etc.
  await runSql(`DELETE FROM public.sites WHERE id IN (${siteIds})`)
  // 5) clients retirés
  await runSql(`DELETE FROM public.clients WHERE id IN (${clientIds})`)

  process.stdout.write(`    Purge terminée — ${REMOVED_SITE_KEYS.length} sites, ${REMOVED_CLIENT_KEYS.length} clients supprimés\n`)
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
  await purgeRemovedSites()
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
  await seedPlanningCycles(authIds)

  // Showcase CPS Siège — contenu vivant pour la démonstration
  console.log(`\n  ── Showcase CPS Siège social ──`)
  await seedShowcaseSite(authIds)
  await seedShowcaseMeetings(authIds)
  await seedTeamFieldMembers(authIds)
  await seedTenders(authIds)

  const showcaseCaptures = SHOWCASE_VISITS.reduce((s, v) => s + v.captures.length, 0)

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
  console.log(`  Interventions: ${SITES.length * 2 * 7} (7/mission : 4 passées + 3 futures dont semaine courante)`)
  console.log(`  Actions      : ~${SITES.length * 3} (3-4/site)`)
  console.log(`  Captures     : ~${SITES.length * 4 * 3} (3-4/visite passée)`)
  console.log(`  ── Showcase CPS Siège ──`)
  console.log(`  Visites riches  : ${SHOWCASE_VISITS.length} (${showcaseCaptures} captures détaillées)`)
  console.log(`  Réunions        : ${SHOWCASE_MEETINGS.length} avec participants + CR IA`)
  console.log(`  Personnes actives: 5 contacts liés aux équipes`)
  console.log(`  AO              : 2 appels d'offres avec analyses IA`)
  console.log(`  Roulements      : ${SITES.length * 2} cycles published (2/site)`)
}

main().catch((e) => {
  console.error('\n❌', e.message)
  process.exit(1)
})
