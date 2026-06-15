'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { upsertSiteDayLog } from '@/lib/db/site-day-log'

const WEATHER = [
  'clear', 'cloudy', 'rain', 'heavy_rain', 'wind', 'storm', 'heat', 'other',
] as const

const schema = z.object({
  siteId: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  weather: z.enum(WEATHER).nullable(),
  intemperie: z.boolean(),
  note: z.string().trim().max(280).nullable(),
})

export async function recordDayWeatherAction(input: {
  siteId: string
  logDate: string
  weather: (typeof WEATHER)[number] | null
  intemperie: boolean
  note: string | null
}): Promise<{ ok: true } | { error: string }> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const user = await getCurrentUserWithProfile()
  if (!user) return { error: 'Non authentifié' }
  // Le journal de chantier est piloté côté superviseur, pas par le terrain.
  if (user.role === 'chef_equipe') return { error: 'Non autorisé' }

  await upsertSiteDayLog({
    siteId: parsed.data.siteId,
    logDate: parsed.data.logDate,
    weather: parsed.data.weather,
    intemperie: parsed.data.intemperie,
    note: parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null,
    userId: user.id,
  })

  revalidatePath(`/sites/${parsed.data.siteId}/journal`)
  return { ok: true }
}
