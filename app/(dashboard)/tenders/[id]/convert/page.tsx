import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTender } from '@/lib/db/tenders'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { ConvertWizard } from './convert-wizard'

const ELIGIBLE_STATUSES = ['ready', 'submitted', 'archived'] as const

export default async function ConvertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tender = await getTender(id)
  if (!tender) notFound()

  if (!ELIGIBLE_STATUSES.includes(tender.status as typeof ELIGIBLE_STATUSES[number])) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6">
          <h2 className="text-sm font-semibold text-rose-800 mb-2">
            Conversion impossible
          </h2>
          <p className="text-sm text-rose-800">
            Cet AO est en status <strong>{tender.status}</strong>.
            La conversion en contrat n&apos;est possible que pour les AO finalisés
            (status <code>ready</code>, <code>submitted</code> ou <code>archived</code>).
          </p>
          <Link
            href={`/tenders/${id}`}
            className="inline-block mt-3 text-sm underline hover:text-rose-900"
          >
            Retour à l&apos;AO
          </Link>
        </div>
      </div>
    )
  }

  const engagements = await listEngagementsByTender(id)

  return <ConvertWizard tender={tender} engagements={engagements} />
}
