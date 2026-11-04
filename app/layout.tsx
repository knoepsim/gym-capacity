import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import AutoRefresh from './components/AutoRefresh'
import { OfflineBlocker } from './components/OfflineBlocker'
import { ThemeProvider } from './components/ThemeProvider'
import ServiceWorkerRegister from './components/ServiceWorkerRegister'
import { SiteHeader } from './components/SiteHeader'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: "Fitness Studio Auslastung",
  description: "Echtzeit-Überwachung der Auslastung in Fitness Studios",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de" className={inter.variable} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f9fafb" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#12151d" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <SiteHeader />
            <OfflineBlocker>
              <ServiceWorkerRegister />
              <AutoRefresh />
              {children}
              <Toaster position="bottom-center" />
            </OfflineBlocker>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
