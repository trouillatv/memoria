// Chantier E — Slice E.1 : page rapport mensuel preview.
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - AUCUN texte généré IA — uniquement données factuelles
//   - AUCUN score qualité — uniquement compteurs et deltas numériques
//   - AUCUN nom d'agent (anonymisation totale)
//   - Note libre DG = signature humaine (sa voix, pas l'IA). Champ optionnel.
//
// Le rendu interactif (sélection photos, note, action approve) vit dans
// MonthlyReportEditor (client). Cette page reste un thin orchestrator :
// auth + fetch + dispatch.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getContractMonthlyReport } from '@/lib/db/monthly-report'
import { getLastMonthlyReportNote } from '@/lib/db/proof-share'
import { MonthlyReportEditor } from './MonthlyReportEditor'
import { MonthNavigation } from './MonthNavigation'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}

/**
 * Mois précédent en format YYYY-MM.
 * Par défaut on cible le mois fini (= mois précédent), pas le mois en cours :
 * un rapport mensuel se construit sur un mois clôturé.
 */
function defaultPreviousMonth(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = now.getMonth() // 0..11
  if (m === 0) {
    return `${y - 1}-12`
  }
  return `${y}-${String(m).padStart(2, '0')}`
}

export default async function MonthlyReportPage({ params, searchParams }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { month: monthParam } = await searchParams

  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : defaultPreviousMonth()

  let data
  try {
    data = await getContractMonthlyReport(id, month)
  } catch {
    notFound()
  }
  if (!data) notFound()

  // MC-6 — Note du dernier rapport mensuel approuvé (pré-remplissage proposé).
  // Best-effort : si la requête échoue, on ignore silencieusement (la feature
  // est une commodité, jamais bloquante).
  let previousNote: { month: string; note: string } | null = null
  try {
    previousNote = await getLastMonthlyReportNote({ contractId: id, excludeMonth: month })
  } catch {
    previousNote = null
  }

  return (
    <div className="w-full space-y-6 py-4">
      <Link
        href={`/contracts/${id}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Retour au contrat
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Rapport mensuel — {data.contract.client_name}</h1>
        <p className="text-sm text-muted-foreground">
          {data.contract.name} · {capitalize(data.period.monthLabel)}
        </p>
      </header>

      <MonthNavigation contractId={id} currentMonth={month} />

      <MonthlyReportEditor
        data={data}
        contractId={id}
        month={month}
        previousNote={previousNote}
      />
    </div>
  )
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
