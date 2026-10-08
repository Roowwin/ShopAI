import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "RFO Backoffice", description: "RFO staff portal" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="bg-slate-100 min-h-screen text-slate-900 antialiased">{children}</body>
    </html>
  );
}