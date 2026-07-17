import 'server-only'

// ── LA SOURCE UNIQUE DU COMPTE-RENDU ─────────────────────────────────────────
// « Le système ne peut pas avoir deux vérités. » (Vincent, 2026-07-17)
//
// Le PDF affichait « Décisions », « Intervenants », « Points de vigilance »,
// « À savoir » depuis `debrief_analysis` — le JSON FIGÉ de l'analyse IA — pendant
// que l'écran juste à côté affichait les vraies `site_decisions`. Même titre,
// deux objets. Écarter une proposition ne changeait rien au PDF : le document
// qui part chez le client continuait d'affirmer ce que le conducteur avait
// refusé.
//
// Ce read model est LA source : mobile, desktop et PDF le lisent, et ne
// touchent plus jamais `debrief_analysis` pour ces objets. Le PDF devient un
// renderer.
//
// ── POURQUOI DEUX ÉTATS, ET PAS « LE VALIDÉ SEUL » ─────────────────────────
// Sur une visite réelle : 6 faits confirmés, 11 encore proposés. N'afficher que
// le validé viderait le compte-rendu d'une visite fraîche — celle qu'on veut
// justement envoyer le soir même. Mais tout afficher à plat ferait passer une
// supposition pour un fait dans un document qui engage.
//
// Donc les deux, SÉPARÉS. C'est la doctrine du produit, appliquée au document :
// l'IA fait apparaître, l'humain décide ce qui devient vrai. Le renderer choisit
// comment le dire ; il ne choisit pas ce qui est vrai.
//
// Ce qui NE vient pas d'ici : le récit (`debrief.summary`), les photos, les
// verbatims. Ce ne sont pas des objets métier — ils n'ont pas de cycle de
// validation, et rien ne peut les contredire.

import { createAdminClient } from '@/lib/supabase/admin'
import { echeanceLine } from '@/lib/visits/echeance-labels'

/** Un fait du compte-rendu, et ce qu'il vaut. */
export interface SummaryItem {
  id: string
  title: string
  detail: string | null
}

/**
 * Un type de fait, dans ses DEUX états. Jamais fusionnés : « confirmé » est ce
 * que le chantier sait, « proposé » est ce que MemorIA croit avoir compris.
 */
export interface SummarySection {
  /** Validé par un humain : l'objet métier existe. Fait foi. */
  confirmed: SummaryItem[]
  /** En attente d'un geste. Ne fait PAS foi — le dire est la moitié du travail. */
  proposed: SummaryItem[]
}

export interface VisitSummary {
  reportId: string
  actions: SummarySection
  deadlines: SummarySection
  decisions: SummarySection
  stakeholders: SummarySection
  watchpoints: SummarySection
  knowledge: SummarySection
}

const EMPTY: SummarySection = { confirmed: [], proposed: [] }

export function emptyVisitSummary(reportId: string): VisitSummary {
  return {
    reportId,
    actions: { ...EMPTY }, deadlines: { ...EMPTY }, decisions: { ...EMPTY },
    stakeholders: { ...EMPTY }, watchpoints: { ...EMPTY }, knowledge: { ...EMPTY },
  }
}

/**
 * Ce que cette visite a produit — objets validés d'un côté, propositions de
 * l'autre.
 *
 * Les propositions viennent de `site_knowledge_proposals`, PAS du JSON : c'est
 * la même donnée, mais avec son CYCLE DE VIE. Une proposition écartée n'y est
 * plus ; une lecture périmée ('superseded') non plus. C'est exactement ce que le
 * JSON était incapable de dire.
 */
export async function getVisitSummary(reportId: string): Promise<VisitSummary> {
  const db = createAdminClient()

  const [props, actions, deadlines, decisions, intervenants, watchpoints, entries] = await Promise.all([
    db.from('site_knowledge_proposals').select('id, kind, title, body, payload').eq('report_id', reportId).eq('status', 'proposed'),
    // ⚠️ NI `site_actions` NI `site_decisions` n'ont de `deleted_at` (colonnes
    // vérifiées en base). Filtrer dessus fait ÉCHOUER la requête, qui renvoie
    // zéro ligne SANS erreur visible — le CR aurait affiché « 0 action validée »
    // pour toujours, en silence. Même faute que 'watchpoint' vs 'vigilance' :
    // un filtre sur ce que la base ne connaît pas ne crie pas, il efface.
    db.from('site_actions').select('id, title, body').eq('report_id', reportId),
    db.from('site_deadlines').select('id, title, due_date, constraint_text').eq('report_id', reportId),
    db.from('site_decisions').select('id, titre, description').eq('report_id', reportId),
    db.from('site_intervenants').select('id, role, company_id').eq('source_report_id', reportId).is('effective_to', null),
    db.from('site_watchpoints').select('id, title, body').eq('report_id', reportId).is('deleted_at', null),
    db.from('site_knowledge_entries').select('id, title, body, kind').eq('source_report_id', reportId).is('deleted_at', null),
  ])

  // Le nom de l'entreprise : un intervenant validé se dit « Sotrap — ETV », pas
  // par son UUID de société.
  const companyIds = ((intervenants.data ?? []) as Array<{ company_id: string }>).map((i) => i.company_id)
  const names = new Map<string, string>()
  if (companyIds.length > 0) {
    const { data: cos } = await db.from('companies').select('id, name').in('id', [...new Set(companyIds)])
    for (const c of (cos ?? []) as Array<{ id: string; name: string }>) names.set(c.id, c.name)
  }

  const proposedOf = (kind: string): SummaryItem[] =>
    ((props.data ?? []) as Array<{ id: string; kind: string; title: string; body: string | null; payload: Record<string, unknown> }>)
      .filter((p) => p.kind === kind)
      .map((p) => ({
        id: p.id,
        // Une échéance dit CE QUI doit arriver et QUAND on le sait — une date si
        // elle a été donnée, sinon la contrainte telle qu'elle a été formulée.
        title: kind === 'deadline'
          ? echeanceLine({
              label: p.title,
              date: String(p.payload?.date ?? ''),
              constraint: String(p.payload?.constraint ?? ''),
            })
          : p.title,
        detail: p.body,
      }))

  return {
    reportId,
    actions: {
      confirmed: ((actions.data ?? []) as Array<{ id: string; title: string; body: string | null }>)
        .map((a) => ({ id: a.id, title: a.title, detail: a.body })),
      proposed: proposedOf('action'),
    },
    deadlines: {
      confirmed: ((deadlines.data ?? []) as Array<{ id: string; title: string; due_date: string | null; constraint_text: string | null }>)
        .map((d) => ({
          id: d.id,
          title: echeanceLine({ label: d.title, date: d.due_date ?? '', constraint: d.constraint_text ?? '' }),
          detail: null,
        })),
      proposed: proposedOf('deadline'),
    },
    decisions: {
      confirmed: ((decisions.data ?? []) as Array<{ id: string; titre: string; description: string | null }>)
        .map((d) => ({ id: d.id, title: d.titre, detail: d.description })),
      proposed: proposedOf('decision'),
    },
    stakeholders: {
      confirmed: ((intervenants.data ?? []) as Array<{ id: string; role: string; company_id: string }>)
        .map((i) => ({ id: i.id, title: `${names.get(i.company_id) ?? '—'} — ${i.role}`, detail: null })),
      proposed: proposedOf('stakeholder'),
    },
    watchpoints: {
      confirmed: ((watchpoints.data ?? []) as Array<{ id: string; title: string; body: string | null }>)
        .map((w) => ({ id: w.id, title: w.title, detail: w.body })),
      proposed: proposedOf('vigilance'),
    },
    knowledge: {
      confirmed: ((entries.data ?? []) as Array<{ id: string; title: string; body: string | null; kind: string }>)
        .map((k) => ({
          id: k.id,
          title: k.title,
          // La nature choisie par l'humain survit jusqu'au document.
          detail: k.body ?? (k.kind === 'current_information' ? 'Information actuelle' : 'Connaissance durable'),
        })),
      proposed: proposedOf('knowledge'),
    },
  }
}
