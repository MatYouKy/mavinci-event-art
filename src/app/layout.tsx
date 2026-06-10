import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "CRM - Monitor Przetargów",
  description: "System monitorowania przetargów dla branży eventowej",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body className={`${geistSans.variable} font-sans antialiased bg-[#0a0d1a] text-[#e5e4e2]`}>
        {children}
      </body>
    </html>
  );
}
