import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export interface VisitSituationItem {
  title: string
  dueDate: string | null
  isOverdue: boolean
}

export interface VisitSituation {
  /** Actions ouvertes du chantier (hors done/cancelled), triées par urgence. Max 5. */
  actionsOpen: VisitSituationItem[]
  /** Échéances à venir non closes, triées par date. Max 4. */
  deadlinesComing: VisitSituationItem[]
}

/**
 * Charge l'état opérationnel du chantier APRÈS la visite.
 * Uniquement les données actionnables (actions ouvertes, échéances).
 * Ne touche pas au moteur IA — 100 % déterministe.
 */
export async function buildVisitSituation(siteId: string): Promise<VisitSituation> {
  const supabase = createAdminClient()
  const today = new Date()

  const [actionsResult, deadlinesResult] = await Promise.all([
    supabase
      .from('site_actions')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .in('status', ['open', 'planned', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from('site_deadlines')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .in('status', ['to_plan', 'planned'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(4),
  ])

  return {
    actionsOpen: (actionsResult.data ?? []).map((a) => ({
      title: a.title,
      dueDate: a.due_date ?? null,
      isOverdue: a.due_date ? new Date(a.due_date) < today : false,
    })),
    deadlinesComing: (deadlinesResult.data ?? []).map((d) => ({
      title: d.title,
      dueDate: d.due_date ?? null,
      isOverdue: d.due_date ? new Date(d.due_date) < today : false,
    })),
  }
}
