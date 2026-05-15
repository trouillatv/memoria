# Plan 2 / 5 — Bibliothèque AGP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le Module 4 (Bibliothèque AGP) — une page unique `/library` avec CRUD complet sur `knowledge_items` (créer / lire / mettre à jour / soft-delete), filtres par catégorie + recherche par tags, upload de fichier optionnel vers le bucket `library-documents`. Cette bibliothèque sera consommée par l'orchestrateur IA en Plan 3 pour grounder les analyses d'AO.

**Architecture:** Suit les conventions Plan 1 — tous les accès DB centralisés dans `lib/db/knowledge.ts`, Server Actions auditées via `logAuditEvent`, validation `zod` partout, components shadcn/ui (`@base-ui/react` style — pas d'`asChild`), pas de state global.

**Tech Stack:** Existant (Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui, Supabase Cloud). **Aucune nouvelle dépendance prod** — uniquement le pattern CRUD déjà éprouvé en Plan 1.

**Spec de référence:** `docs/superpowers/specs/2026-05-09-memoria-mvp-design.md` § 10 (Module 4 — Bibliothèque AGP).

---

## Structure de fichiers à créer

```
.
├─ app/(dashboard)/library/
│  ├─ page.tsx                       # liste + filtres
│  ├─ actions.ts                     # 4 Server Actions auditées (create, update, soft_delete, undo)
│  ├─ KnowledgeItemTable.tsx         # tableau avec édition / suppression inline
│  ├─ KnowledgeItemDrawer.tsx        # drawer create/edit (form RHF + zod)
│  ├─ KnowledgeCategoryFilter.tsx    # chips de filtre catégorie
│  ├─ KnowledgeTagsInput.tsx         # multi-tags chips dans le form
│  └─ KnowledgeTagsFilter.tsx        # chips dynamiques depuis tags existants
├─ lib/db/knowledge.ts                # 5 query functions
├─ types/db.ts                        # ajouter DbKnowledgeItem
└─ tests/lib/knowledge.test.ts        # 2-3 tests sur la sérialisation library-context (préparation Plan 3)
```

---

## Pré-requis vérifiés (depuis Plan 1)

- ✅ Table `knowledge_items` existe en DB (migration 007) avec colonnes : `id, title, category, content_markdown, file_path, tags, created_at, deleted_at`
- ✅ Enum `knowledge_category` avec 6 valeurs
- ✅ Bucket `library-documents` créé (privé) avec policy SELECT pour authenticated users
- ✅ RLS sur `knowledge_items` : manager + admin only
- ✅ Pattern Server Action + audit logging établi en Plan 1
- ✅ shadcn components disponibles : button, card, input, label, drawer, select, textarea, badge, dialog

---

## Task 1 : Types + lib/db/knowledge.ts

**Files:**
- Modify: `types/db.ts` (ajouter `DbKnowledgeItem`)
- Create: `lib/db/knowledge.ts`

- [ ] **Step 1.1 : Étendre `types/db.ts`**

Ajouter à la fin du fichier `types/db.ts` (après `DbActivityLog`) :

```ts
export interface DbKnowledgeItem {
  id: string
  title: string
  category: KnowledgeCategory
  content_markdown: string
  file_path: string | null
  tags: string[] | null
  created_at: string
  deleted_at: string | null
}
```

- [ ] **Step 1.2 : Créer `lib/db/knowledge.ts`**

```ts
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbKnowledgeItem, KnowledgeCategory } from '@/types/db'

export interface KnowledgeQuery {
  category?: KnowledgeCategory
  tags?: string[]        // any-of match
  search?: string        // full-text on title + content_markdown
}

/**
 * Liste les items de bibliothèque non supprimés.
 * Filtres optionnels par catégorie / tags / recherche full-text.
 * Lecture standard via le client serveur (RLS-protected, manager+admin only).
 */
export async function listKnowledgeItems(query: KnowledgeQuery = {}): Promise<DbKnowledgeItem[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('knowledge_items')
    .select('id, title, category, content_markdown, file_path, tags, created_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (query.category) q = q.eq('category', query.category)
  if (query.tags && query.tags.length > 0) q = q.overlaps('tags', query.tags)
  if (query.search) {
    const s = query.search.replace(/[%_]/g, '\\$&')
    q = q.or(`title.ilike.%${s}%,content_markdown.ilike.%${s}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DbKnowledgeItem[]
}

/**
 * Récupère un item par id (incluant soft-deleted, pour pouvoir l'éditer/restaurer).
 */
export async function getKnowledgeItem(id: string): Promise<DbKnowledgeItem | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .select('id, title, category, content_markdown, file_path, tags, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as DbKnowledgeItem
}

/**
 * Crée un nouvel item. Retourne l'id créé.
 * Service role bypass RLS (l'autorisation manager+admin est vérifiée en amont par requireManager).
 */
export async function createKnowledgeItem(input: {
  title: string
  category: KnowledgeCategory
  content_markdown: string
  file_path?: string | null
  tags?: string[] | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .insert({
      title: input.title,
      category: input.category,
      content_markdown: input.content_markdown,
      file_path: input.file_path ?? null,
      tags: input.tags ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('No id returned')
  return data.id
}

/**
 * Met à jour un item existant (champs partiels).
 */
export async function updateKnowledgeItem(
  id: string,
  fields: Partial<{
    title: string
    category: KnowledgeCategory
    content_markdown: string
    file_path: string | null
    tags: string[] | null
  }>
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('knowledge_items').update(fields).eq('id', id)
  if (error) throw error
}

/**
 * Soft delete : pose `deleted_at = now()`.
 */
export async function softDeleteKnowledgeItem(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('knowledge_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Liste les tags distincts utilisés dans la bibliothèque (pour le filtre).
 * Renvoie un tableau de strings unique, trié alphabétiquement.
 */
export async function listAllTags(): Promise<string[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('knowledge_items')
    .select('tags')
    .is('deleted_at', null)
    .not('tags', 'is', null)
  if (error) throw error
  const set = new Set<string>()
  for (const row of data ?? []) {
    for (const t of (row.tags as string[] | null) ?? []) set.add(t)
  }
  return Array.from(set).sort()
}
```

- [ ] **Step 1.3 : Verify tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 1.4 : Commit**

```bash
git add types/db.ts lib/db/knowledge.ts
git commit -m "feat(lib/db): knowledge.ts CRUD + DbKnowledgeItem type"
```

---

## Task 2 : Server Actions auditées (`app/(dashboard)/library/actions.ts`)

**Files:**
- Create: `app/(dashboard)/library/actions.ts`

- [ ] **Step 2.1 : Créer le fichier**

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'
import {
  createKnowledgeItem,
  updateKnowledgeItem,
  softDeleteKnowledgeItem,
  getKnowledgeItem,
} from '@/lib/db/knowledge'
import { getUserRoleById } from '@/lib/db/users'

async function requireManagerOrAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const role = await getUserRoleById(user.id)
  if (role !== 'manager' && role !== 'admin') throw new Error('Forbidden')
  return user.id
}

const KNOWLEDGE_CATEGORIES = [
  'references_clients',
  'moyens_humains',
  'materiel',
  'procedures',
  'qualite',
  'anciens_memoires',
] as const

const upsertSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  content_markdown: z.string().min(1),
  file_path: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
})

const idSchema = z.object({ id: z.string().uuid() })

export async function createKnowledgeItemAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const tagsRaw = formData.get('tags')
  const parsed = upsertSchema.safeParse({
    title: formData.get('title'),
    category: formData.get('category'),
    content_markdown: formData.get('content_markdown'),
    file_path: formData.get('file_path') || null,
    tags: typeof tagsRaw === 'string' && tagsRaw.length > 0 ? JSON.parse(tagsRaw) : null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const id = await createKnowledgeItem(parsed.data)
  await logAuditEvent({
    userId, entityType: 'knowledge_item', entityId: id,
    action: 'created',
    metadata: { title: parsed.data.title, category: parsed.data.category },
  })
  revalidatePath('/library')
  return { ok: true, id }
}

export async function updateKnowledgeItemAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const idParsed = idSchema.safeParse({ id: formData.get('id') })
  if (!idParsed.success) return { error: 'Invalid id' }

  const tagsRaw = formData.get('tags')
  const parsed = upsertSchema.safeParse({
    title: formData.get('title'),
    category: formData.get('category'),
    content_markdown: formData.get('content_markdown'),
    file_path: formData.get('file_path') || null,
    tags: typeof tagsRaw === 'string' && tagsRaw.length > 0 ? JSON.parse(tagsRaw) : null,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await updateKnowledgeItem(idParsed.data.id, parsed.data)
  await logAuditEvent({
    userId, entityType: 'knowledge_item', entityId: idParsed.data.id,
    action: 'updated',
    metadata: { title: parsed.data.title, category: parsed.data.category },
  })
  revalidatePath('/library')
  return { ok: true }
}

export async function deleteKnowledgeItemAction(formData: FormData) {
  const userId = await requireManagerOrAdmin()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'Invalid id' }

  const before = await getKnowledgeItem(parsed.data.id)
  await softDeleteKnowledgeItem(parsed.data.id)
  await logAuditEvent({
    userId, entityType: 'knowledge_item', entityId: parsed.data.id,
    action: 'soft_deleted',
    metadata: { title: before?.title, category: before?.category },
  })
  revalidatePath('/library')
  return { ok: true }
}

/**
 * Upload un fichier vers le bucket library-documents.
 * Stocké sous {timestamp}-{filename-sanitized}. Renvoie le path pour usage dans file_path.
 */
const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
})

export async function uploadKnowledgeFileAction(formData: FormData) {
  await requireManagerOrAdmin()
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file' }

  const parsed = uploadSchema.safeParse({ filename: file.name })
  if (!parsed.success) return { error: 'Invalid filename' }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  const path = `${Date.now()}-${safeName}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from('library-documents')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { error: error.message }

  return { ok: true, path }
}
```

- [ ] **Step 2.2 : Verify tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 2.3 : Commit**

```bash
git add app/\(dashboard\)/library/actions.ts
git commit -m "feat(library): 4 Server Actions auditées (create/update/delete/upload)"
```

---

## Task 3 : Composants form (Drawer + TagsInput)

**Files:**
- Create: `app/(dashboard)/library/KnowledgeTagsInput.tsx`
- Create: `app/(dashboard)/library/KnowledgeItemDrawer.tsx`

- [ ] **Step 3.1 : Créer `KnowledgeTagsInput.tsx`**

```tsx
'use client'

import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export function KnowledgeTagsInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function add(t: string) {
    const trimmed = t.trim().toLowerCase()
    if (!trimmed) return
    if (value.includes(trimmed)) return
    onChange([...value, trimmed])
    setDraft('')
  }

  function remove(t: string) {
    onChange(value.filter((x) => x !== t))
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        placeholder="Ajouter un tag (Entrée pour valider)…"
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                className="hover:text-destructive"
                aria-label={`Retirer le tag ${t}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3.2 : Créer `KnowledgeItemDrawer.tsx`**

```tsx
'use client'

import { useState, type FormEvent } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KnowledgeTagsInput } from './KnowledgeTagsInput'
import { createKnowledgeItemAction, updateKnowledgeItemAction, uploadKnowledgeFileAction } from './actions'
import { toast } from 'sonner'
import type { DbKnowledgeItem, KnowledgeCategory } from '@/types/db'

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains:     'Moyens humains',
  materiel:           'Matériel',
  procedures:         'Procédures',
  qualite:            'Qualité',
  anciens_memoires:   'Anciens mémoires techniques',
}

export function KnowledgeItemDrawer({
  trigger,
  item,
}: {
  trigger: React.ReactNode
  item?: DbKnowledgeItem
}) {
  const isEdit = !!item
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item?.title ?? '')
  const [category, setCategory] = useState<KnowledgeCategory>(item?.category ?? 'references_clients')
  const [contentMarkdown, setContentMarkdown] = useState(item?.content_markdown ?? '')
  const [tags, setTags] = useState<string[]>(item?.tags ?? [])
  const [filePath, setFilePath] = useState<string | null>(item?.file_path ?? null)
  const [pending, setPending] = useState(false)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { toast.error('Fichier > 10 MB'); return }
    const fd = new FormData()
    fd.append('file', f)
    const r = await uploadKnowledgeFileAction(fd)
    if (r?.error) toast.error(r.error)
    else if (r?.path) { setFilePath(r.path); toast.success('Fichier uploadé') }
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
      <DrawerTrigger render={trigger as React.ReactElement} />
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle>{isEdit ? 'Modifier l\'élément' : 'Ajouter un élément'}</DrawerTitle>
        </DrawerHeader>
        <form onSubmit={onSubmit} className="px-4 py-2 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as KnowledgeCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map((k) => (
                  <SelectItem key={k} value={k}>{CATEGORY_LABELS[k]}</SelectItem>
                ))}
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
                Fichier actuel : <code className="font-mono">{filePath}</code>
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
              {pending ? 'Enregistrement…' : isEdit ? 'Mettre à jour' : 'Créer'}
            </Button>
            <DrawerClose render={<Button type="button" variant="outline">Annuler</Button>} />
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
```

⚠️ Note `@base-ui/react` : `DrawerTrigger` et `DrawerClose` utilisent `render={...}` (PAS `asChild`). Vérifie la signature exacte dans `components/ui/drawer.tsx` si jamais le `render` ne prend pas un ReactElement directement — adapte si besoin.

- [ ] **Step 3.3 : Verify tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3.4 : Commit**

```bash
git add app/\(dashboard\)/library/KnowledgeTagsInput.tsx app/\(dashboard\)/library/KnowledgeItemDrawer.tsx
git commit -m "feat(library): drawer form create/edit + multi-tags chips input"
```

---

## Task 4 : Composants liste (Table + Filters)

**Files:**
- Create: `app/(dashboard)/library/KnowledgeItemTable.tsx`
- Create: `app/(dashboard)/library/KnowledgeCategoryFilter.tsx`
- Create: `app/(dashboard)/library/KnowledgeTagsFilter.tsx`

- [ ] **Step 4.1 : Créer `KnowledgeCategoryFilter.tsx`**

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { useRouter, useSearchParams } from 'next/navigation'
import type { KnowledgeCategory } from '@/types/db'

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains:     'Moyens humains',
  materiel:           'Matériel',
  procedures:         'Procédures',
  qualite:            'Qualité',
  anciens_memoires:   'Anciens mémoires',
}

export function KnowledgeCategoryFilter() {
  const router = useRouter()
  const params = useSearchParams()
  const current = params.get('category') as KnowledgeCategory | null

  function setCategory(c: KnowledgeCategory | null) {
    const next = new URLSearchParams(params.toString())
    if (c === null || c === current) next.delete('category')
    else next.set('category', c)
    router.push(`/library${next.toString() ? '?' + next.toString() : ''}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Badge
        variant={current === null ? 'default' : 'outline'}
        className="cursor-pointer"
        onClick={() => setCategory(null)}
      >
        Toutes
      </Badge>
      {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map((k) => (
        <Badge
          key={k}
          variant={current === k ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setCategory(k)}
        >
          {CATEGORY_LABELS[k]}
        </Badge>
      ))}
    </div>
  )
}
```

- [ ] **Step 4.2 : Créer `KnowledgeTagsFilter.tsx`**

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { useRouter, useSearchParams } from 'next/navigation'

export function KnowledgeTagsFilter({ allTags }: { allTags: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const current = (params.get('tags') ?? '').split(',').filter(Boolean)

  function toggle(t: string) {
    const next = new URLSearchParams(params.toString())
    const set = new Set(current)
    if (set.has(t)) set.delete(t)
    else set.add(t)
    if (set.size === 0) next.delete('tags')
    else next.set('tags', Array.from(set).join(','))
    router.push(`/library${next.toString() ? '?' + next.toString() : ''}`)
  }

  if (allTags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      <span className="text-xs text-muted-foreground self-center mr-1">Tags :</span>
      {allTags.map((t) => (
        <Badge
          key={t}
          variant={current.includes(t) ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => toggle(t)}
        >
          {t}
        </Badge>
      ))}
    </div>
  )
}
```

- [ ] **Step 4.3 : Créer `KnowledgeItemTable.tsx`**

```tsx
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
```

- [ ] **Step 4.4 : Verify tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 4.5 : Commit**

```bash
git add app/\(dashboard\)/library/KnowledgeCategoryFilter.tsx app/\(dashboard\)/library/KnowledgeTagsFilter.tsx app/\(dashboard\)/library/KnowledgeItemTable.tsx
git commit -m "feat(library): table + chips de filtres catégorie/tags"
```

---

## Task 5 : Page `/library` (Server Component)

**Files:**
- Create: `app/(dashboard)/library/page.tsx`

- [ ] **Step 5.1 : Créer `page.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { listKnowledgeItems, listAllTags } from '@/lib/db/knowledge'
import { KnowledgeItemTable } from './KnowledgeItemTable'
import { KnowledgeCategoryFilter } from './KnowledgeCategoryFilter'
import { KnowledgeTagsFilter } from './KnowledgeTagsFilter'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import type { KnowledgeCategory } from '@/types/db'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tags?: string; search?: string }>
}) {
  const params = await searchParams
  const category = params.category as KnowledgeCategory | undefined
  const tags = params.tags ? params.tags.split(',').filter(Boolean) : undefined
  const search = params.search

  const [items, allTags] = await Promise.all([
    listKnowledgeItems({ category, tags, search }),
    listAllTags(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Bibliothèque AGP</h1>
          <p className="text-sm text-muted-foreground">
            Références clients, moyens, procédures, certifications. Utilisée par l&apos;IA pour grounder les réponses aux AO.
          </p>
        </div>
        <KnowledgeItemDrawer
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form>
            <Input
              type="search"
              name="search"
              placeholder="Rechercher dans les titres et contenus…"
              defaultValue={search ?? ''}
            />
          </form>
          <KnowledgeCategoryFilter />
          <KnowledgeTagsFilter allTags={allTags} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {items.length} élément{items.length > 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <KnowledgeItemTable items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5.2 : Verify tsc + dev server**

```bash
npx tsc --noEmit
npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 6
cat /tmp/dev.log | tail -20
kill $DEV_PID 2>/dev/null
```

Expected : "✓ Ready in …" no errors.

- [ ] **Step 5.3 : Commit**

```bash
git add app/\(dashboard\)/library/page.tsx
git commit -m "feat(library): page /library avec liste + filtres + bouton Ajouter"
```

---

## Task 6 : Tests + manual smoke

**Files:**
- Create: `tests/lib/knowledge.test.ts`

- [ ] **Step 6.1 : Créer un test simple sur `listAllTags` (sérialisation tags)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock le client server pour pouvoir tester listAllTags sans Supabase
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { listAllTags } from '@/lib/db/knowledge'

describe('listAllTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dédoublonne et trie les tags', async () => {
    const fakeData = [
      { tags: ['iso9001', 'ecolabel'] },
      { tags: ['iso9001', 'rgpd'] },
      { tags: null },
      { tags: ['ecolabel', 'environnement'] },
    ]
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          is: () => ({
            not: () => Promise.resolve({ data: fakeData, error: null }),
          }),
        }),
      }),
    } as never)

    const tags = await listAllTags()
    expect(tags).toEqual(['ecolabel', 'environnement', 'iso9001', 'rgpd'])
  })

  it('retourne tableau vide quand aucun item', async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          is: () => ({
            not: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    } as never)
    const tags = await listAllTags()
    expect(tags).toEqual([])
  })
})
```

- [ ] **Step 6.2 : Run tests**

```bash
npm test
```

Expected: 5 tests pass (3 from Plan 1 + 2 new).

- [ ] **Step 6.3 : Manual smoke test (à faire par l'utilisateur final, pas par l'agent)**

Document dans le commit message les étapes de smoke test :

1. `npm run dev`
2. Login `admin@memoria.nc` / nouveau mdp
3. Sidebar → cliquer « Bibliothèque » → arriver sur `/library` (vide)
4. Cliquer « Ajouter » → drawer s'ouvre → remplir titre, catégorie, contenu, 2 tags → Créer
5. L'item apparaît dans la liste
6. Cliquer sur l'icône crayon → drawer s'ouvre pré-rempli → modifier le contenu → Mettre à jour
7. Filtrer par catégorie via les chips → seul l'item de la catégorie s'affiche
8. Filtrer par tag → idem
9. Cliquer sur l'icône poubelle → confirmation → l'item disparaît
10. Aller sur `/admin/monitoring` → voir 3 entrées (created, updated, soft_deleted) sur entité `knowledge_item`

- [ ] **Step 6.4 : Commit**

```bash
git add tests/lib/knowledge.test.ts
git commit -m "test(library): listAllTags dedup + sort"
```

---

## Task 7 : Final review + cleanup

- [ ] **Step 7.1 : Verify all checks**

```bash
npx tsc --noEmit
npm test
```

Both must pass.

- [ ] **Step 7.2 : Verify all DB access via lib/db**

```bash
grep -rn ".from('knowledge_items')" app/ --include="*.ts" --include="*.tsx"
```

Should return 0 results — all access goes through `lib/db/knowledge.ts`.

- [ ] **Step 7.3 : Manual smoke test (handoff to user)**

Tell the user to run the manual smoke test from Task 6 Step 6.3.

---

## Critères d'acceptance — Plan 2

- [ ] `/library` page accessible aux roles `admin` + `manager` (chef_equipe redirigé/sidebar absent — Plan 1 cover ça déjà via `AppSidebar`)
- [ ] Création d'un item via drawer fonctionne (titre, catégorie, contenu markdown, tags optionnels, fichier optionnel)
- [ ] Edit d'un item via drawer fonctionne (form pré-rempli, mise à jour propagée)
- [ ] Soft delete fonctionne (item disparaît de la liste, `deleted_at` posé en DB)
- [ ] Filtre par catégorie via chips fonctionne (URL mise à jour, liste filtrée)
- [ ] Filtre par tags via chips fonctionne (any-of match)
- [ ] Recherche full-text dans titre + contenu fonctionne
- [ ] Upload de fichier joint vers `library-documents` fonctionne (max 10 MB)
- [ ] Toutes les Server Actions auditées dans `activity_logs` (entity_type=`knowledge_item`)
- [ ] Aucune requête `.from('knowledge_items')` en dehors de `lib/db/knowledge.ts`
- [ ] `npx tsc --noEmit` passe, `npm test` passe (5 tests)

## Hors-scope explicite (laissé à plus tard)

- Vue archive / restauration des items soft-deleted (V2)
- Versioning (historique d'éditions) — pas demandé au MVP
- Export bibliothèque en CSV/JSON
- Preview markdown live dans le drawer (au lieu du textarea brut) — joli mais pas critique
- Drag-and-drop pour les tags (Entrée/virgule/Backspace suffisent)
