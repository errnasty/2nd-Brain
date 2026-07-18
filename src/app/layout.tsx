import type { Metadata, Viewport } from "next";
import { Crimson_Pro, DM_Sans, Lora } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsEffects } from "@/components/settings-effects";
import { SwRegister } from "@/components/shell/sw-register";
import { Toaster } from "sonner";
import "./globals.css";

// Optional body fonts (default stays Georgia/system). next/font self-hosts them
// and exposes CSS variables the Settings font picker switches between.
const crimson = Crimson_Pro({ subsets: ["latin"], display: "swap", variable: "--font-crimson" });
const lora = Lora({ subsets: ["latin"], display: "swap", variable: "--font-lora" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Your RSS reader, knowledge base, and AI briefing engine.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
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
    <html lang="en" suppressHydrationWarning className={`${crimson.variable} ${lora.variable} ${dmSans.variable}`}>
      <body className="theme-transition">
        {/* Set the colour palette before first paint so switching away from the
            default (parchment) doesn't flash. Mirrors next-themes' own anti-FOUC
            script; safe under suppressHydrationWarning since React doesn't own
            the data-palette attribute. Tries the signed-in account's scoped key
            first (see scopedKey in lib/settings), then the legacy shared key. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var h=localStorage.getItem('app.activeUser.v1');var p=(h&&localStorage.getItem('app.palette.v1.u_'+h))||localStorage.getItem('app.palette.v1');if(p)document.documentElement.setAttribute('data-palette',p);}catch(e){}",
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <SettingsEffects />
          <SwRegister />
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
