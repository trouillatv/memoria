import { Badge } from '@/components/ui/badge'
import type { TenderStatus } from '@/types/db'

const LABELS: Record<TenderStatus, string> = {
  draft:       'Brouillon',
  extracting:  'Extraction',
  analyzing:   'Analyse IA',
  ready:       'Prêt',
  failed:      'Échec',
  submitted:   'Soumis',
  archived:    'Archivé',
}

const STYLES: Record<TenderStatus, string> = {
  draft:       'bg-slate-100 text-slate-700',
  extracting:  'bg-blue-100 text-blue-700 animate-pulse',
  analyzing:   'bg-amber-100 text-amber-700 animate-pulse',
  ready:       'bg-emerald-100 text-emerald-700',
  failed:      'bg-rose-100 text-rose-700',
  submitted:   'bg-purple-100 text-purple-700',
  archived:    'bg-gray-100 text-gray-500',
}

export function TenderStatusBadge({ status }: { status: TenderStatus }) {
  return <Badge className={`text-xs ${STYLES[status]}`}>{LABELS[status]}</Badge>
}
