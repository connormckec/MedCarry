import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedCarry · Your medication list",
  description: "Capture your medication labels, confirm each entry, and prepare a current list for your care team.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
