import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/providers/ThemeProvider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: 'NetoIAge',
  description: 'Gestion terrain & appels d\'offres pour entreprises de nettoyage',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'NetoIAge',
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
