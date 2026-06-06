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
          {/* Nav : grille 3×2 sur mobile, ligne sur desktop */}
          <nav className="grid grid-cols-3 gap-1 md:flex md:items-center md:gap-4">
            <Link href="/admin/users"       className="text-center md:text-left text-xs text-slate-300 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Utilisateurs</Link>
            <Link href="/admin/preparation" className="text-center md:text-left text-xs text-slate-300 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Préparation</Link>
            <Link href="/admin/monitoring"  className="text-center md:text-left text-xs text-slate-300 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Monitoring</Link>
            <Link href="/admin/feedback"    className="text-center md:text-left text-xs text-slate-300 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Feedback</Link>
            <Link href="/admin/backfill"    className="text-center md:text-left text-xs text-slate-300 hover:text-white bg-slate-800 md:bg-transparent rounded px-2 py-2 md:p-0">Backfill IA</Link>
            <Link href="/missions"          className="col-span-2 md:col-span-1 md:ml-auto text-center md:text-left text-xs text-slate-400 hover:text-white bg-slate-700 md:bg-transparent rounded px-2 py-2 md:p-0">← Retour app</Link>
          </nav>
        </div>
      </header>
      <main className="w-full px-4 md:px-8 py-6 md:py-8 [&>*]:!mx-0 [&>*]:!w-full [&>*]:!max-w-none">{children}</main>
    </div>
  )
}
