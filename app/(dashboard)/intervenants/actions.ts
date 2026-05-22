'use server'

// Création d'un nouvel intervenant — Vincent 2026-05-21.
//
// Différent de createUserAction (/admin/users) qui est admin-only :
// ICI manager+admin peuvent créer pour les besoins du pilote Guillaume.
// Le mot de passe temporaire partagé reste le même pattern produit.
//
// Doctrine MemorIA :
//   - Champs RH structurels (commune, employment_type) autorisés
//   - JAMAIS comparatif côté UI (pas de tri par employment_type, pas de
//     filtre « CDI only »)
//   - logAuditEvent obligatoire (cohérence avec /admin/users)

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit/log'
import { updateUserProfileAsAdmin, getUserRoleById } from '@/lib/db/users'
import { updateContractEndDate } from '@/lib/db/continuity'

// Mdp temporaire partagé — décision DG 2026-05-14 (même que /admin/users)
const TEMP_PASSWORD = 'memoria2026'

const createSchema = z
  .object({
    email:            z.string().email('Email invalide'),
    full_name:        z.string().min(1, 'Nom requis').max(120),
    role:             z.enum(['admin', 'manager', 'chef_equipe']),
    phone:            z.string().optional().nullable(),
    commune:          z.string().max(120).optional().nullable(),
    employment_type:  z.enum(['cdi', 'cdd', 'cdi_chantier']).optional().nullable(),
    contract_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide').optional().nullable(),
  })
  // CDD / CDI Chantier → on doit savoir QUAND le contrat se termine (pour
  // anticiper la passation de mémoire). Un CDI n'a pas de fin attendue.
  .refine(
    (d) =>
      !(d.employment_type === 'cdd' || d.employment_type === 'cdi_chantier') ||
      !!d.contract_end_date,
    {
      message: 'Indiquez la date de fin du contrat (CDD / CDI Chantier).',
      path: ['contract_end_date'],
    },
  )

export type CreateIntervenantInput = z.infer<typeof createSchema>

async function requireManagerOrAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Non authentifié' }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') {
    return { ok: false, error: 'Accès refusé — manager ou admin requis' }
  }
  return { ok: true, userId: user.id }
}

export async function createIntervenantAction(
  input: CreateIntervenantInput,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return auth

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Champs invalides' }
  }

  const supabase = createAdminClient()

  // Mode temp_password : le manager communique le mdp partagé à l'agent.
  // Le must_change_password sera enforcé au premier login.
  const { data, error } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: TEMP_PASSWORD,
    email_confirm: true,
    app_metadata: {
      role: parsed.data.role,
      must_change_password: true,
    },
    user_metadata: {
      full_name: parsed.data.full_name,
      role: parsed.data.role,
    },
  })
  if (error) {
    // Erreur fréquente : email déjà utilisé
    if (/already/i.test(error.message)) {
      return { ok: false, error: 'Un utilisateur avec cet email existe déjà.' }
    }
    return { ok: false, error: error.message }
  }
  if (!data.user) return { ok: false, error: 'Création échouée — aucun user retourné' }

  // Persiste les champs profil étendus (commune, employment_type, phone).
  await updateUserProfileAsAdmin(data.user.id, {
    full_name: parsed.data.full_name,
    role: parsed.data.role,
    must_change_password: true,
    phone: parsed.data.phone ?? null,
    commune: parsed.data.commune ?? null,
    employment_type: parsed.data.employment_type ?? null,
  })

  // Date de fin de contrat (CDD / CDI Chantier) — alimente la Continuité.
  if (parsed.data.contract_end_date) {
    await updateContractEndDate(data.user.id, parsed.data.contract_end_date)
  }

  await logAuditEvent({
    userId: auth.userId,
    entityType: 'user',
    entityId: data.user.id,
    action: 'created',
    metadata: {
      kind: 'intervenant_created',
      mode: 'temp_password',
      email: parsed.data.email,
      role: parsed.data.role,
      has_employment_type: !!parsed.data.employment_type,
      has_commune: !!parsed.data.commune,
    },
  })

  revalidatePath('/intervenants')
  return { ok: true, userId: data.user.id }
}
