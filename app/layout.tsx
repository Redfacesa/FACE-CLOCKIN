import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Face Clock",
  description: "Restaurant attendance with encrypted face templates and an audit trail.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
