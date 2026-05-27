import type { Metadata } from "next"
import { Inter, Geist } from "next/font/google"
import "./globals.css"
import AutoRefresh from './components/AutoRefresh'
import { FeedbackWidget } from './components/FeedbackWidget'
import { ThemeProvider } from './components/ThemeProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

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
    <html lang="de" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <TooltipProvider>
            <AutoRefresh />
            <FeedbackWidget />
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
