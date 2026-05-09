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
