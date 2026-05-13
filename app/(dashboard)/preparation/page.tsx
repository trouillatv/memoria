// Sprint 4 PC — Page « Préparation du soir » pour Maeva.
//
// Doctrine V5 :
//   - Pilier 3 (frontières humaines) : NetoIAge prépare le plateau, WhatsApp
//     livre. Cette page produit le message pré-rédigé, Maeva décide de
//     l'envoyer à chaque chef d'équipe individuellement.
//   - Pilier 4 (DG amplifié) : Maeva reste auteur signataire — édition
//     contrainte par toggles + note libre 140 chars (verrou V5).
//   - Maxim 9 : envois 1-à-1, jamais en groupe WhatsApp collectif.
//   - Verrou V6 : aucun timestamp d'envoi persisté (badge UI temporaire only).

import { redirect } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  generateChefEquipePreparations,
  tomorrowUtcIso,
} from '@/lib/db/chef-equipe-preparation'
import { ChefEquipeCard } from './ChefEquipeCard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS_FR = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d))
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const month = MONTHS_FR_FULL[(m ?? 1) - 1] ?? ''
  return `${weekday} ${d} ${month} ${y}`
}

export default async function PreparationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // chef_equipe consulte son propre demain via /briefing (vue M2). Cette page
  // est réservée à Maeva (admin/manager).
  if (user.role === 'chef_equipe') redirect('/m')

  const params = await searchParams
  const forDate =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : tomorrowUtcIso()

  const preparations = await generateChefEquipePreparations(forDate)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-brand-600" />
          Préparation du soir
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatDateLong(forDate)}. À envoyer à chaque chef d&apos;équipe via
          WhatsApp, individuellement.
        </p>
      </header>

      {preparations.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground italic">
            Aucune intervention prévue demain pour un chef d&apos;équipe.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {preparations.map((p) => (
            <ChefEquipeCard key={p.userId} preparation={p} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground italic pt-2">
        Préparations descriptives. Vous restez l&apos;auteur du message final.
      </p>
    </div>
  )
}
