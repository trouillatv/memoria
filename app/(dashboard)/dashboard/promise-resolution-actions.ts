'use server'

// Actions serveur de résolution des promesses (Cockpit, T3). Une action par
// geste métier — contrats clairs, autorisations testables — au-dessus d'un moteur
// commun (lib/db/promise-resolution). Le client n'envoie QUE le sujet et les
// champs métier ; l'IDENTITÉ et l'ORGANISATION sont résolues et vérifiées ICI,
// côté serveur, jamais reçues comme données fiables du formulaire.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import {
  fulfillPromise, cancelPromise, replacePromise, createPromiseFollowUp,
  type PromiseResolutionResult,
} from '@/lib/db/promise-resolution'

const SubjectSchema = z.object({
  table: z.enum(['captured_knowledge', 'site_knowledge_proposals']),
  id: z.string().min(1),
  organizationId: z.string().min(1),
  siteId: z.string().min(1),
})

type Ctx = { userId: string; allowedOrgIds: string[] }
type ActionError = { error: string }

// Résout l'utilisateur desk et ses organisations. Le client ne peut ni les
// fournir ni les usurper : tout vient de la session serveur.
async function deskContext(): Promise<Ctx | ActionError> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié.' }
  if (user.role !== 'admin' && user.role !== 'manager') return { error: 'Accès refusé.' }
  return { userId: user.id, allowedOrgIds: await getOrgIdsOfUser() }
}

function finalize(result: PromiseResolutionResult) {
  if (result.status === 'resolved') {
    // Le signal résolu doit disparaître du dashboard à la prochaine lecture.
    revalidatePath('/dashboard')
    return { ok: true as const, outcome: result.outcome, replacementId: result.replacementId ?? null }
  }
  if (result.status === 'already_terminal') return { error: 'Cette promesse a déjà été résolue.' }
  return { error: 'Promesse introuvable.' }
}

/** Marquer une promesse comme RÉALISÉE (tenue) — aucune action ni échéance créée. */
export async function fulfillPromiseAction(input: { subject: unknown }) {
  const ctx = await deskContext()
  if ('error' in ctx) return ctx
  const subject = SubjectSchema.safeParse(input.subject)
  if (!subject.success) return { error: 'Sujet invalide.' }
  return finalize(await fulfillPromise({ subject: subject.data, userId: ctx.userId, allowedOrgIds: ctx.allowedOrgIds }))
}

/** ANNULER une promesse (plus attendue) — motif fortement recommandé. */
export async function cancelPromiseAction(input: { subject: unknown; reason?: string }) {
  const ctx = await deskContext()
  if ('error' in ctx) return ctx
  const subject = SubjectSchema.safeParse(input.subject)
  if (!subject.success) return { error: 'Sujet invalide.' }
  const reason = typeof input.reason === 'string' ? input.reason.trim() || null : null
  return finalize(await cancelPromise({ subject: subject.data, userId: ctx.userId, allowedOrgIds: ctx.allowedOrgIds, reason }))
}

/** REMPLACER : la remplaçante est saisie dans le même geste (création + lien +
 *  terminalisation, atomique par compensation). Choisir une promesse existante
 *  est hors V1. */
export async function replacePromiseAction(input: { subject: unknown; title?: string; body?: string }) {
  const ctx = await deskContext()
  if ('error' in ctx) return ctx
  const subject = SubjectSchema.safeParse(input.subject)
  if (!subject.success) return { error: 'Sujet invalide.' }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title.length < 3) return { error: 'La promesse remplaçante doit être formulée (3 caractères min).' }
  return finalize(await replacePromise({
    subject: subject.data, userId: ctx.userId, allowedOrgIds: ctx.allowedOrgIds,
    replacement: { title, body: typeof input.body === 'string' ? input.body.trim() || null : null },
  }))
}

/** Créer une ACTION DE SUIVI — geste distinct : la promesse N'EST PAS résolue. */
export async function createPromiseFollowUpAction(input: { subject: unknown; title?: string; body?: string }) {
  const ctx = await deskContext()
  if ('error' in ctx) return ctx
  const subject = SubjectSchema.safeParse(input.subject)
  if (!subject.success) return { error: 'Sujet invalide.' }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title.length < 3) return { error: "L'action de suivi doit avoir un intitulé (3 caractères min)." }
  const r = await createPromiseFollowUp({
    subject: subject.data, userId: ctx.userId, allowedOrgIds: ctx.allowedOrgIds,
    title, body: typeof input.body === 'string' ? input.body.trim() || null : null,
  })
  if (r.status !== 'created') return { error: 'Promesse introuvable.' }
  revalidatePath('/dashboard')
  return { ok: true as const, actionId: r.actionId }
}
