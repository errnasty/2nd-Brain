import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsEffects } from "@/components/settings-effects";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Your RSS reader, knowledge base, and AI briefing engine.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Allow pinch-zoom (a11y); cover so env(safe-area-inset-*) resolves on notch
  // devices for the fixed mobile top/bottom bars.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-serif">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <SettingsEffects />
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
