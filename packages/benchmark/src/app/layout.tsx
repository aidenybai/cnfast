import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "cn benchmark",
  description:
    "Compare cnfast against clsx and tailwind-merge across real component repositories, rendering workloads, and bundle size.",
};

const RootLayout = ({ children }: RootLayoutProps) => (
  <html
    className={`${geistSans.variable} ${geistMono.variable}`}
    lang="en"
    suppressHydrationWarning
  >
    <body>
      <ThemeProvider>{children}</ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
