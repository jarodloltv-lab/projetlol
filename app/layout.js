import Link from "next/link";
import { Space_Grotesk, Sora } from "next/font/google";
import "./globals.css";

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-body"
});

const titleFont = Sora({
  subsets: ["latin"],
  variable: "--font-title"
});

export const metadata = {
  title: "LoL Comp Builder",
  description: "Genere des compositions League of Legends coherentes selon un style de jeu."
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className={`${bodyFont.variable} ${titleFont.variable}`}>
        <header className="site-nav">
          <div className="site-nav-inner">
            <Link href="/" className="site-brand">
              LoL Draft Lab
            </Link>

            <nav className="site-links">
              <Link href="/">Draft complete</Link>
              <Link href="/botlane">Page botlane</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
