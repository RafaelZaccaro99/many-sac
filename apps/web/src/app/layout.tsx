import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Many Zac",
  description: "Plataforma de automação conversacional omnichannel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
