import Link from 'next/link'
import { TenderStatusBadge } from './[id]/TenderStatusBadge'
import type { DbTender } from '@/types/db'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function deadlineClass(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'text-rose-700 font-medium'
  if (days < 7) return 'text-rose-700 font-medium'
  if (days < 30) return 'text-amber-700'
  return ''
}

export function TenderListTable({ items }: { items: DbTender[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Aucun dossier. Cliquez sur &laquo;&nbsp;Nouveau&nbsp;&raquo; pour commencer.
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Titre</th>
            <th className="text-left px-3 py-2">Donneur d&apos;ordre</th>
            <th className="text-left px-3 py-2">Échéance</th>
            <th className="text-left px-3 py-2">Statut</th>
            <th className="text-right px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((t) => (
            <tr key={t.id} className="hover:bg-muted/20">
              <td className="px-3 py-2">
                <Link href={`/tenders/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{t.client_name ?? '—'}</td>
              <td className={`px-3 py-2 text-xs ${deadlineClass(t.deadline)}`}>{formatDate(t.deadline)}</td>
              <td className="px-3 py-2"><TenderStatusBadge status={t.status} /></td>
              <td className="px-3 py-2 text-right">
                <Link href={`/tenders/${t.id}`} className="text-xs text-brand-600 hover:underline">Voir</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
