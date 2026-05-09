'use client'

import { useState, type FormEvent } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KnowledgeTagsInput } from './KnowledgeTagsInput'
import {
  createKnowledgeItemAction,
  updateKnowledgeItemAction,
  uploadKnowledgeFileAction,
} from './actions'
import { toast } from 'sonner'
import type { DbKnowledgeItem, KnowledgeCategory } from '@/types/db'

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains: 'Moyens humains',
  materiel: 'Matériel',
  procedures: 'Procédures',
  qualite: 'Qualité',
  anciens_memoires: 'Anciens mémoires techniques',
}

export function KnowledgeItemDrawer({
  trigger,
  item,
}: {
  trigger: React.ReactElement
  item?: DbKnowledgeItem
}) {
  const isEdit = !!item
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item?.title ?? '')
  const [category, setCategory] = useState<KnowledgeCategory>(
    item?.category ?? 'references_clients',
  )
  const [contentMarkdown, setContentMarkdown] = useState(
    item?.content_markdown ?? '',
  )
  const [tags, setTags] = useState<string[]>(item?.tags ?? [])
  const [filePath, setFilePath] = useState<string | null>(
    item?.file_path ?? null,
  )
  const [pending, setPending] = useState(false)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      toast.error('Fichier > 10 MB')
      return
    }
    const fd = new FormData()
    fd.append('file', f)
    const r = await uploadKnowledgeFileAction(fd)
    if (r?.error) toast.error(r.error)
    else if (r?.path) {
      setFilePath(r.path)
      toast.success('Fichier uploadé')
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    const fd = new FormData()
    fd.set('title', title)
    fd.set('category', category)
    fd.set('content_markdown', contentMarkdown)
    fd.set('file_path', filePath ?? '')
    fd.set('tags', JSON.stringify(tags))
    if (isEdit && item) fd.set('id', item.id)

    const r = isEdit
      ? await updateKnowledgeItemAction(fd)
      : await createKnowledgeItemAction(fd)
    setPending(false)
    if (r?.error) toast.error(r.error)
    else {
      toast.success(isEdit ? 'Item mis à jour' : 'Item créé')
      setOpen(false)
      if (!isEdit) {
        setTitle('')
        setContentMarkdown('')
        setTags([])
        setFilePath(null)
      }
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle>
            {isEdit ? "Modifier l'élément" : 'Ajouter un élément'}
          </DrawerTitle>
        </DrawerHeader>
        <form
          onSubmit={onSubmit}
          className="px-4 py-2 space-y-4 overflow-y-auto"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Catégorie</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as KnowledgeCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map(
                  (k) => (
                    <SelectItem key={k} value={k}>
                      {CATEGORY_LABELS[k]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Contenu (markdown)</Label>
            <Textarea
              id="content"
              value={contentMarkdown}
              onChange={(e) => setContentMarkdown(e.target.value)}
              required
              rows={8}
              placeholder="Description, détails techniques, références…"
            />
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <KnowledgeTagsInput value={tags} onChange={setTags} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">Fichier joint (optionnel, max 10 MB)</Label>
            <Input id="file" type="file" onChange={onUpload} />
            {filePath && (
              <p className="text-xs text-muted-foreground">
                Fichier actuel :{' '}
                <code className="font-mono">{filePath}</code>
                <button
                  type="button"
                  onClick={() => setFilePath(null)}
                  className="ml-2 text-destructive hover:underline"
                >
                  Retirer
                </button>
              </p>
            )}
          </div>
          <DrawerFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? 'Enregistrement…'
                : isEdit
                  ? 'Mettre à jour'
                  : 'Créer'}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Annuler
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
