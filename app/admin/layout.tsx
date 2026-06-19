import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/missions')

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="w-full px-4 md:px-8 py-3">
          {/* Titre */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center font-bold shrink-0">N</div>
            <div>
              <div className="text-base font-semibold">MemorIA — Admin</div>
              <div className="text-xs text-slate-400">Gestion utilisateurs &amp; monitoring</div>
            </div>
          </div>
          {/* Nav : 3 entrées claires (Personnes · Activité · Dépenses IA).
              Refonte 2026-06-15 — 6 onglets épars → 3 réponses concrètes. */}
          <nav className="grid grid-cols-2 gap-1 md:flex md:items-center md:gap-5">
            <Link href="/admin/personnes"   className="text-center md:text-left text-sm font-medium text-slate-200 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Personnes</Link>
            <Link href="/admin/activite"    className="text-center md:text-left text-sm font-medium text-slate-200 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Activité</Link>
            <Link href="/admin/depenses-ia" className="text-center md:text-left text-sm font-medium text-slate-200 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Dépenses IA</Link>
            <Link href="/admin/analyse-ao"  className="text-center md:text-left text-sm font-medium text-slate-200 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Analyse AO</Link>
            <Link href="/admin/usage"       className="text-center md:text-left text-sm font-medium text-slate-200 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Usage</Link>
            <Link href="/missions"          className="col-span-2 md:col-span-1 md:ml-auto text-center md:text-left text-xs text-slate-400 hover:text-white bg-slate-700 md:bg-transparent rounded px-2 py-2 md:p-0">← Retour app</Link>
          </nav>
        </div>
      </header>
      <main className="w-full px-4 md:px-8 py-6 md:py-8 [&>*]:!mx-0 [&>*]:!w-full [&>*]:!max-w-none">{children}</main>
    </div>
  )
}
