'use client'

import { Pencil, Trash2, Paperclip, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import { deleteKnowledgeItemAction } from './actions'
import { toast } from 'sonner'
import { CATEGORY_LABELS_FULL, CATEGORY_COLORS } from './category-targets'
import type { DbKnowledgeItem } from '@/types/db'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (d < 1) return "aujourd'hui"
  if (d === 1) return 'hier'
  if (d < 30) return `il y a ${d} j`
  const months = Math.floor(d / 30)
  if (months < 12) return `il y a ${months} mois`
  return `il y a ${Math.floor(months / 12)} an${Math.floor(months / 12) > 1 ? 's' : ''}`
}

function isStale(updatedAt: string): boolean {
  const months = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  return months > 6
}

interface Props {
  item: DbKnowledgeItem
  citationCount: number
}

export function KnowledgeItemCard({ item, citationCount }: Props) {
  const colors = CATEGORY_COLORS[item.category]
  const stale = isStale(item.updated_at ?? item.created_at)

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Supprimer « ${item.title} » ?`)) return
    const fd = new FormData()
    fd.set('id', item.id)
    const r = await deleteKnowledgeItemAction(fd)
    if (r?.error) toast.error(r.error)
    else toast.success('Élément supprimé')
  }

  // Excerpt 2-3 lignes du content
  const excerpt = item.content_markdown
    .replace(/^#+\s+/gm, '')           // Strip headings
    .replace(/[*_`]/g, '')              // Strip markdown emphasis
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 3)
    .join(' ')
    .slice(0, 200)

  return (
    <div className="group rounded-xl border bg-card p-4 hover:border-foreground/20 transition-colors flex flex-col gap-3 min-h-[180px]">
      {/* Top row : badge cat + file icon */}
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${colors.bg} ${colors.text}`}>
          {CATEGORY_LABELS_FULL[item.category]}
        </span>
        <div className="flex items-center gap-1">
          {item.file_path && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Fichier joint" />}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold leading-snug line-clamp-2">{item.title}</h3>

      {/* Excerpt */}
      <p className="text-xs text-muted-foreground line-clamp-3 flex-1">
        {excerpt || <span className="italic">(Pas de description)</span>}
      </p>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((t) => (
            <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 h-4">{t}</Badge>
          ))}
          {item.tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground self-center">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          {citationCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-foreground font-medium">
              <Zap className="h-3 w-3 text-amber-500" />
              Cité {citationCount}× ce mois
            </span>
          ) : (
            <span className="italic">Pas encore cité</span>
          )}
        </div>
        <span className={stale ? 'text-amber-700' : ''}>
          {timeAgo(item.updated_at ?? item.created_at)}
          {stale && ' ⚠️'}
        </span>
      </div>

      {/* Actions hover */}
      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity -mt-2">
        <KnowledgeItemDrawer
          item={item}
          trigger={
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <Pencil className="h-3 w-3 mr-1" />
              Modifier
            </Button>
          }
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="h-7 px-2 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
