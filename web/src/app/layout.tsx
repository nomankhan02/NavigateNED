import type { Metadata } from "next";
import "@/styles/tokens.css";

export const metadata: Metadata = {
  title: "NavigateNED",
  description: "Campus Navigation System for NED University"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

