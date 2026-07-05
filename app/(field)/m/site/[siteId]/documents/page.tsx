import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, FileText, FileImage, File as FileIcon, ExternalLink } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { SiteTabs } from '../SiteTabs'

export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL = 300 // 5 min

/**
 * Documents d'un chantier (mobile) — question métier unique : montre-moi les
 * documents de ce chantier. Réservé au conducteur (admin/manager) : sur desktop
 * les documents sont déjà interdits au chef d'équipe, on garde la même frontière.
 * Chaque document s'ouvre via une URL signée courte (aperçu inline). On
 * n'affiche RIEN d'inventé : uniquement les documents réellement liés au site.
 */
export default async function SiteDocumentsMobilePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  // Même frontière de rôle que le desktop : les documents ne sont pas un
  // objet terrain du chef d'équipe.
  if (user.role !== 'admin' && user.role !== 'manager') redirect(`/m/site/${siteId}`)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const docs = await listDocumentsForTarget('site', siteId).catch(() => [])
  const signed = await Promise.all(
    docs.map(async (d) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, SIGNED_URL_TTL)
      return { id: d.id, filename: d.filename || 'Document', url: data?.signedUrl ?? null }
    }),
  )

  // Icône dérivée de l'extension du nom de fichier (pas de mime stocké).
  const iconFor = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return FileImage
    if (ext === 'pdf') return FileText
    return FileIcon
  }

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Documents</h1>
        <SiteTabs siteId={siteId} active="documents" userRole={user.role} />
      </header>

      {signed.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun document lié à ce chantier.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card divide-y">
          {signed.map((d) => {
            const Icon = iconFor(d.filename)
            return (
              <li key={d.id}>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3.5 py-3 active:bg-accent"
                  >
                    <Icon className="h-5 w-5 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.filename}</span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <div className="flex items-center gap-3 px-3.5 py-3 opacity-60">
                    <Icon className="h-5 w-5 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.filename}</span>
                    <span className="text-[11px] text-muted-foreground">indisponible</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
