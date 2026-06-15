import { Badge } from '@/components/ui/badge'
import type { DbActivityLog } from '@/types/db'

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'à l\'instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  return `il y a ${d} j`
}

const ACTION_LABEL: Record<string, string> = {
  analysis_relaunched:    'Analyse dossier relancée',
  status_changed:         'Changement de statut',
  closed:                 'Mission clôturée',
  soft_deleted:           'Suppression',
  role_changed:           'Changement de rôle',
  password_reset_forced:  'Reset MdP forcé',
  validated:              'Rapport validé',
  created:                'Création',
  updated:                'Modification',
}

export function ActivityLogTable({ logs }: { logs: DbActivityLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Aucun log.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Quand</th>
            <th className="text-left px-3 py-2">Entité</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-left px-3 py-2">Détails</th>
            <th className="text-left px-3 py-2">Par user</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {logs.map((l) => (
            <tr key={l.id} className="hover:bg-muted/20">
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatRelative(l.created_at)}</td>
              <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{l.entity_type}</Badge></td>
              <td className="px-3 py-2 text-xs">{ACTION_LABEL[l.action] ?? l.action}</td>
              <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                {l.metadata ? JSON.stringify(l.metadata).slice(0, 80) + (JSON.stringify(l.metadata).length > 80 ? '…' : '') : '—'}
              </td>
              <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{l.user_id?.slice(0, 8) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
