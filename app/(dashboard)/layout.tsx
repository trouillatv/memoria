import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopbar } from '@/components/layout/AppTopbar'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.must_change_password) redirect('/change-password')

  const fullName = user.full_name || user.email
  return (
    <div className="min-h-screen bg-muted/20">
      <AppSidebar role={user.role} fullName={fullName} />
      <div className="md:pl-60">
        <AppTopbar fullName={fullName} />
        <main className="px-4 md:px-8 py-6 pb-24 md:pb-6">{children}</main>
      </div>
      {user.role === 'chef_equipe' && <MobileBottomNav />}
    </div>
  )
}
