'use client'

import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push('/login')
      }}
      title="Se déconnecter"
    >
      <LogOut className="h-4 w-4" />
    </Button>
  )
}
