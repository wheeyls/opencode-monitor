import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "arb",
  description: "arb work queue dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800 bg-zinc-900/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              arb
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
