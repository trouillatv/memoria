// Points HUMAINS ajoutés au CR (mig 130) : remarques libres rattachées à une section.
// Ajout (pas une correction de la mémoire structurée).
import { createAdminClient } from '@/lib/supabase/admin'

export type HumanPointSection = 'ordre_du_jour' | 'points_examines' | 'avancement' | 'previsions' | 'securite'

export interface HumanPoint {
  id: string
  section: HumanPointSection
  text: string
  sortOrder: number
}

export async function listReportHumanPoints(reportId: string): Promise<HumanPoint[]> {
  const { data } = await createAdminClient()
    .from('report_human_points')
    .select('id, section, text, sort_order')
    .eq('report_id', reportId)
    .order('section', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    section: r.section as HumanPointSection,
    text: r.text as string,
    sortOrder: r.sort_order as number,
  }))
}

export async function addReportHumanPoint(input: {
  reportId: string
  section: HumanPointSection
  text: string
  createdBy: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('report_human_points')
    .insert({ report_id: input.reportId, section: input.section, text: input.text, created_by: input.createdBy })
  if (error) throw new Error(error.message)
}

export async function removeReportHumanPoint(reportId: string, pointId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('report_human_points')
    .delete()
    .eq('report_id', reportId)
    .eq('id', pointId)
  if (error) throw new Error(error.message)
}
