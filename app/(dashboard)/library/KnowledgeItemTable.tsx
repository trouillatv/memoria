'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, Paperclip } from 'lucide-react'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import { deleteKnowledgeItemAction } from './actions'
import { toast } from 'sonner'
import type { DbKnowledgeItem, KnowledgeCategory } from '@/types/db'

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  references_clients: 'Réfs clients',
  moyens_humains:     'RH',
  materiel:           'Matériel',
  procedures:         'Procédures',
  qualite:            'Qualité',
  anciens_memoires:   'Anciens mémos',
}

const CATEGORY_BADGE: Record<KnowledgeCategory, string> = {
  references_clients: 'bg-blue-100 text-blue-700',
  moyens_humains:     'bg-emerald-100 text-emerald-700',
  materiel:           'bg-amber-100 text-amber-700',
  procedures:         'bg-purple-100 text-purple-700',
  qualite:            'bg-rose-100 text-rose-700',
  anciens_memoires:   'bg-slate-100 text-slate-700',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function KnowledgeItemTable({ items }: { items: DbKnowledgeItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Aucun élément. Cliquez sur « Ajouter » pour commencer à constituer la bibliothèque.
      </p>
    )
  }

  async function onDelete(id: string, title: string) {
    if (!confirm(`Supprimer « ${title} » ?`)) return
    const fd = new FormData()
    fd.set('id', id)
    const r = await deleteKnowledgeItemAction(fd)
    if (r?.error) toast.error(r.error)
    else toast.success('Élément supprimé')
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Titre</th>
            <th className="text-left px-3 py-2">Catégorie</th>
            <th className="text-left px-3 py-2">Tags</th>
            <th className="text-left px-3 py-2">Fichier</th>
            <th className="text-left px-3 py-2">Modifié</th>
            <th className="text-right px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((it) => (
            <tr key={it.id} className="hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="font-medium">{it.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-1">{it.content_markdown.slice(0, 100)}</div>
              </td>
              <td className="px-3 py-2">
                <Badge className={`text-xs ${CATEGORY_BADGE[it.category]}`}>{CATEGORY_LABELS[it.category]}</Badge>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {(it.tags ?? []).slice(0, 3).map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                  ))}
                  {(it.tags ?? []).length > 3 && (
                    <span className="text-xs text-muted-foreground">+{(it.tags ?? []).length - 3}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {it.file_path ? <Paperclip className="h-3 w-3 inline" /> : '—'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(it.created_at)}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <KnowledgeItemDrawer
                    item={it}
                    trigger={
                      <Button size="sm" variant="ghost" title="Modifier">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(it.id, it.title)}
                    title="Supprimer"
                    className="hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
