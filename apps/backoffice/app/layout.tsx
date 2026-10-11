import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "RFO Backoffice", description: "RFO staff portal" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="bg-surface-sunken min-h-screen text-ink-900 antialiased">{children}</body>
    </html>
  );
}
