import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import AutoRefresh from './components/AutoRefresh'
import { FeedbackWidget } from './components/FeedbackWidget'
import { OfflineBlocker } from './components/OfflineBlocker'
import { ThemeProvider } from './components/ThemeProvider'
import ServiceWorkerRegister from './components/ServiceWorkerRegister'

// const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"] })

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
    <html lang="de" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0ea5a4" />
      </head>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <OfflineBlocker>
            <ServiceWorkerRegister />
            <AutoRefresh />
            <FeedbackWidget />
            {children}
          </OfflineBlocker>
        </ThemeProvider>
      </body>
    </html>
  )
}
