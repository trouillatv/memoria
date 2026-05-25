import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/providers/ThemeProvider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: 'MemorIA',
  description: 'Gestion terrain & appels d\'offres pour entreprises de nettoyage',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'MemorIA',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport = {
  themeColor: "#0f172a",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      {/* suppressHydrationWarning sur <body> : neutralise les attributs injectés
          par les extensions navigateur (ColorZilla `cz-shortcut-listen`,
          Grammarly `data-gr-*`, LastPass `data-lastpass-*`, etc.) qui modifient
          le DOM côté client avant l'hydration React. Sans effet sur le rendu. */}
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {/* V5.1 — mode clair par défaut. Plus de detection auto OS qui
            poussait l'app mobile en dark mode sur les iPhones configurés en
            mode sombre. Le toggle ThemeToggle reste fonctionnel : l'user
            peut explicitement passer en dark via le toggle, sa préférence
            sera persistée en localStorage. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} themes={['light', 'dark', 'ocre', 'petrole', 'archive']}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
