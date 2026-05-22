/**
 * Seed AO démo CHT Médipôle — migration 065
 * Exécuter : npx tsx scripts/dev/seed-ao-cht-065.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!url || !key) { console.error('Variables env manquantes'); process.exit(1) }

const sb = createClient(url, key, { auth: { persistSession: false } })

const TITLE = '[DEMO] CHT Médipôle — Bionettoyage blocs opératoires AO-2026-N04'

const EXTRACTED_TEXT = `CHT DE NOUVELLE-CALÉDONIE (MÉDIPÔLE)
Nouméa, le 21 Juin 2026
Référence : AO-2026-N04

AVIS D'APPEL D'OFFRES

Objet de la consultation
Bionettoyage des blocs opératoires et zones stériles

Prestations de nettoyage spécialisé en milieu hospitalier avec protocoles d'asepsie rigoureux.

Lieu des prestations
Médipôle — 1 Avenue du Médipôle, Koutio, Dumbéa, Grand Nouméa.

Description du besoin
Le Centre Hospitalier Territorial de Nouvelle-Calédonie lance un appel d'offres pour la prestation de bionettoyage de ses blocs opératoires, salles de réveil, couloirs stériles et zones de soins intensifs. Les prestations incluent :
- Nettoyage et désinfection quotidienne des 8 blocs opératoires selon protocole ISO 14698
- Bionettoyage des surfaces hautes (soufflage, plafonds, rails de perfusion)
- Traitement terminal hebdomadaire avec produits biocides homologués
- Gestion et traçabilité des produits désinfectants (fiche de données sécurité obligatoire)
- Intervention d'urgence en cas de contamination dans un délai de 2h

Exigences particulières
Le soumissionnaire devra fournir la preuve de son expérience dans des missions similaires de nettoyage professionnel en milieu hospitalier. Une certification ISO 9001 ou équivalent est requise. Le personnel affecté devra avoir suivi une formation spécifique en bionettoyage hospitalier (CQP APH ou équivalent).

DATE LIMITE DE DÉPÔT DES OFFRES : 05 Août 2026 à 15h00
Dépôt électronique : marches@cht.nc

Durée du marché : 3 ans renouvelable une fois.
Valeur estimée : 28 000 000 XPF/an.

Document administratif de simulation — Marché de nettoyage — CHT de Nouvelle-Calédonie (Médipôle) — 2026`

const SUMMARY = `Le CHT de Nouvelle-Calédonie lance un appel d'offres pour le bionettoyage de ses blocs opératoires et zones stériles au Médipôle de Koutio. Le marché porte sur 8 blocs opératoires, salles de réveil, couloirs stériles et zones de soins intensifs, avec des exigences strictes de traçabilité et de protocoles d'asepsie conformes à la norme ISO 14698. Une certification ISO 9001 est requise, ainsi qu'une formation CQP APH pour le personnel. Le marché est d'une durée de 3 ans renouvelable, estimé à 28 MXPF/an. La date limite est fixée au 5 août 2026.`

const TECHNICAL_MEMO = `# Mémoire technique — CHT Médipôle (Bionettoyage blocs opératoires)

## Compréhension du besoin

Le CHT de Nouvelle-Calédonie confie la prestation de bionettoyage de ses blocs opératoires et zones stériles à un prestataire qualifié. Le Médipôle, inauguré en 2023, est le premier hôpital de Nouvelle-Calédonie à avoir intégré des blocs opératoires haute performance dès sa conception. Avec 8 blocs actifs et un flux de 40 à 60 interventions chirurgicales par semaine, l'exigence de rigueur est maximale.

## Notre méthodologie

AGP Nettoyage applique le protocole en 5 phases pour le bionettoyage hospitalier :
1. **Audit initial** — cartographie des zones, identification des niveaux de risque par bloc
2. **Protocole produits** — sélection des désinfectants homologués et rotation selon résistance bactérienne
3. **Exécution traçée** — fiche de traçabilité signée par le chef d'équipe à chaque intervention
4. **Contrôle qualité** — prélèvement ATP bi-mensuel, résultats transmis au responsable hygiène CHT
5. **Reporting mensuel** — tableau de bord transmis à la direction des services techniques

## Moyens humains

Équipe dédiée proposée :
- 1 chef d'équipe bionettoyage formé CQP APH (4 ans d'expérience bloc opératoire)
- 4 agents bionettoyage formés, dont 2 avec expérience en milieu stérile classe ISO 5
- Astreinte 24h/24, 7j/7 pour interventions d'urgence (délai garanti : 90 minutes sur site)

## Références secteur santé NC

- **CHT Gaston-Bourret** (Nouméa) : bionettoyage des services de maternité et pédiatrie — contrat actif depuis 2021
- **Clinique Kuindo-Magnin** : entretien quotidien des blocs de chirurgie ambulatoire — 2020-2023
- **Centre médical de Koumac** : remise en état post-travaux et protocole d'ouverture — 2022

## Engagements qualité spécifiques NC

- Conformité au protocole CLIN (Comité de Lutte contre les Infections Nosocomiales) du CHT
- Respect du silence post-bloc (pas d'intervention non urgente entre 7h et 8h30)
- Produits adaptés au climat tropical : formulation anti-moisissures renforcée
- Stock de sécurité 30 jours maintenu sur site (contrainte logistique insulaire)

---
*Mémoire technique généré pour démo AGP Nettoyage — AO-2026-N04 CHT Médipôle*`

const CONSTRAINTS = [
  {
    label: 'Certification ISO 9001 ou équivalent obligatoire',
    detail: 'Le soumissionnaire doit fournir une certification ISO 9001 en cours de validité avant la date limite de dépôt.',
    category: 'qualité',
    required: true,
    sources: [{ type: 'pdf', quote: 'Une certification ISO 9001 ou équivalent est requise.', page: 1, reasoning: 'Exigence administrative explicite — éliminatoire sans cette certification.' }],
  },
  {
    label: 'Formation CQP APH obligatoire pour le personnel affecté',
    detail: "Chaque agent devra justifier d'une formation CQP Agent de Propreté et d'Hygiène ou formation équivalente reconnue en milieu hospitalier.",
    category: 'qualification',
    required: true,
    sources: [{ type: 'pdf', quote: 'Le personnel affecté devra avoir suivi une formation spécifique en bionettoyage hospitalier (CQP APH ou équivalent).', page: 1, reasoning: 'Condition de qualification du personnel — sans ça, le dossier est recalé.' }],
  },
  {
    label: 'Protocole ISO 14698 pour le bionettoyage des blocs',
    detail: 'Conformité stricte à la norme ISO 14698 pour la surveillance de la contamination biologique des salles blanches et environnements contrôlés.',
    category: 'technique',
    required: true,
    sources: [{ type: 'pdf', quote: 'Nettoyage et désinfection quotidienne des 8 blocs opératoires selon protocole ISO 14698', page: 1, reasoning: 'Norme citée explicitement dans le descriptif technique des prestations.' }],
  },
  {
    label: "Délai d'intervention d'urgence : 2 heures maximum",
    detail: "En cas de contamination ou alerte biologique, le prestataire doit être sur site dans un délai maximum de 2 heures, 24h/24, 7j/7.",
    category: 'délai',
    required: true,
    sources: [{ type: 'pdf', quote: "Intervention d'urgence en cas de contamination dans un délai de 2h", page: 1, reasoning: "Engagement de réactivité contractuellement opposable — critique en contexte hospitalier." }],
  },
  {
    label: 'Traçabilité obligatoire des produits désinfectants (FDS)',
    detail: 'Fiches de données de sécurité obligatoires pour chaque produit biocide utilisé, avec registre de traçabilité tenu à jour.',
    category: 'réglementaire',
    required: true,
  },
  {
    label: 'Produits Ecolabel recommandés',
    detail: "L'usage de produits respectant les normes Ecolabel est vivement encouragé — critère de notation de l'offre.",
    category: 'environnement',
    required: false,
  },
]

const RISKS = [
  {
    label: 'Rupture de stock produits biocides en contexte insulaire',
    severity: 'high' as const,
    detail: "La Nouvelle-Calédonie dépend des importations pour les produits biocides homologués. Un retard de fournisseur peut paralyser le protocole. Nécessite un stock de sécurité 30 jours minimum.",
    sources: [],
  },
  {
    label: 'Disponibilité du personnel formé CQP APH',
    severity: 'high' as const,
    detail: "Le vivier de personnel formé en bionettoyage hospitalier est limité sur Nouméa. Un arrêt maladie ou départ peut compromettre la continuité du service.",
    sources: [],
  },
  {
    label: 'Résistance bactérienne et rotation des biocides',
    severity: 'medium' as const,
    detail: "Sans programme de rotation des désinfectants, des souches résistantes peuvent se développer dans les blocs. Le CHT peut demander des prélèvements ATP à tout moment.",
    sources: [],
  },
  {
    label: 'Pression concurrentielle — marché 28 MXPF/an très visible',
    severity: 'medium' as const,
    detail: "Un marché à 28 MXPF annuels va attirer des prestataires régionaux (Australie, La Réunion) et les grandes enseignes françaises (ISS, Atalian). Nécessite une offre technique solide.",
    sources: [],
  },
  {
    label: 'Contrainte logistique Koutio — accès Médipôle hors Nouméa',
    severity: 'low' as const,
    detail: "Le Médipôle est à 25 km du centre de Nouméa. Les interventions d'urgence nocturnes impliquent des temps de trajet significatifs selon la fluidité de la RT1.",
    sources: [],
  },
]

const CHECKLIST = [
  {
    item: "Référence CHT Gaston-Bourret : bionettoyage maternité/pédiatrie actif depuis 2021 — preuve d'expérience hospitalière NC directe",
    required: true,
    sources: [],
  },
  {
    item: "CQP APH : former au moins 4 agents avant la soumission et joindre les attestations — argument décisif sur la qualification",
    required: true,
    sources: [{ type: 'pdf', quote: 'Le personnel affecté devra avoir suivi une formation spécifique en bionettoyage hospitalier (CQP APH ou équivalent).', page: 1, reasoning: "Le CHT demande explicitement cette formation — la documenter est un différenciateur direct." }],
  },
  {
    item: "Stock de sécurité 30 jours sur site : engagement contractuel adapté au contexte insulaire NC — argument logistique différenciant",
    required: true,
    sources: [],
  },
  {
    item: "Protocole ATP bi-mensuel avec transmission des résultats au CLIN du CHT — preuve de rigueur mesurable",
    required: false,
    sources: [],
  },
  {
    item: "Formulation anti-moisissures adaptée au climat tropical (humidité NC) — spécificité locale que les prestataires métropolitains ignorent souvent",
    required: false,
    sources: [],
  },
  {
    item: "Astreinte garantie 90 min (au lieu des 2h réglementaires) — sur-performance contractuelle valorisable",
    required: false,
    sources: [],
  },
]

async function main() {
  console.log('🔍 Vérification doublon...')
  const { data: existing } = await sb
    .from('tenders')
    .select('id')
    .eq('title', TITLE)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    console.log(`⚠️  AO déjà présent (id=${existing.id}) — aucune insertion.`)
    process.exit(0)
  }

  // Récupérer un user admin
  const { data: users, error: uErr } = await sb.auth.admin.listUsers({ perPage: 1 })
  if (uErr || !users?.users?.length) { console.error('Aucun user trouvé:', uErr?.message); process.exit(1) }
  const adminId = users.users[0].id
  console.log(`👤 Admin utilisé : ${users.users[0].email}`)

  // 1. Tender
  const { data: tender, error: tErr } = await sb
    .from('tenders')
    .insert({
      title: TITLE,
      client_name: 'CHT de Nouvelle-Calédonie (Médipôle)',
      deadline: '2026-08-05',
      status: 'ready',
      opportunity_score: 78,
      created_by: adminId,
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 86400000).toISOString(),
    })
    .select('id')
    .single()
  if (tErr) { console.error('Erreur tender:', tErr.message); process.exit(1) }
  const tenderId = tender.id
  console.log(`✓ Tender créé : ${tenderId}`)

  // 2. Document
  const { error: dErr } = await sb.from('tender_documents').insert({
    tender_id: tenderId,
    storage_path: `seed/${tenderId}/AO-2026-N04-CHT-Medipole.pdf`,
    filename: '[DEMO] AO-2026-N04 CHT Médipôle Bionettoyage.pdf',
    extracted_text: EXTRACTED_TEXT,
    page_count: 4,
    uploaded_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  })
  if (dErr) { console.error('Erreur document:', dErr.message); process.exit(1) }
  console.log('✓ Document créé')

  // 3. Analyse
  const { error: aErr } = await sb.from('tender_analyses').insert({
    tender_id: tenderId,
    summary: SUMMARY,
    technical_memo: TECHNICAL_MEMO,
    constraints: CONSTRAINTS,
    risks: RISKS,
    checklist: CHECKLIST,
    provider: 'mock',
    prompt_versions: { lecteur_ao: 'v2', memoire_technique: 'v1' },
    raw_response: { seed: 'nc-demo-065', ao: 'AO-2026-N04' },
    created_at: new Date(Date.now() - 86400000).toISOString(),
  })
  if (aErr) { console.error('Erreur analyse:', aErr.message); process.exit(1) }
  console.log('✓ Analyse créée (summary + technical_memo + 6 contraintes + 5 risques + 6 différenciateurs)')

  console.log(`\n✅ AO démo CHT Médipôle inséré avec succès !`)
  console.log(`   → /tenders/${tenderId}`)
}

main().catch(e => { console.error(e); process.exit(1) })
