import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/utils";
import { getSession } from "@/lib/auth";
import { themeById } from "@/lib/themes";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Shared inbox for support mail",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The signed-in agent's theme, set on <html> as the page renders so there's
  // no flash of the default. Public pages (survey links) use the default.
  const theme = themeById((await getSession().catch(() => null))?.agent.theme);
  return (
    <html
      lang="en"
      data-theme={theme.id}
      className={theme.dark ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
