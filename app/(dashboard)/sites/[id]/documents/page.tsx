import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, QrCode, Download, FileText } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { HubGrid } from '../HubGrid'

export const dynamic = 'force-dynamic'

export default async function SiteDocumentsHub({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const docs = await listDocumentsForTarget('site', id).catch(() => [])
  const canExport = user.role === 'admin' || user.role === 'manager'
  const items = [
    { href: `/sites/${id}/preuves`, label: 'Dossier de preuve', desc: 'Coffre-fort / décennale.', icon: <ShieldCheck className="h-5 w-5" />, badge: docs.length > 0 ? `${docs.length} doc${docs.length > 1 ? 's' : ''}` : null },
    { href: `/sites/${id}/qr`, label: 'QR Code', desc: 'Partage externe d’un accès.', icon: <QrCode className="h-5 w-5" /> },
    ...(canExport ? [{ href: `/sites/${id}/export`, label: 'Exporter', desc: 'Export Excel + photos (propriété des données).', icon: <Download className="h-5 w-5" /> }] : []),
  ]

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><FileText className="h-5 w-5" /> Documents</h1>
        <p className="text-sm text-muted-foreground">
          {docs.length} document{docs.length > 1 ? 's' : ''} lié{docs.length > 1 ? 's' : ''} — preuves, partage et export.
        </p>
      </header>
      <HubGrid items={items} />
    </div>
  )
}
