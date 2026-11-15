import type { Metadata } from "next";
import "@fontsource/bricolage-grotesque/500.css";
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/familjen-grotesk/400.css";
import "@fontsource/familjen-grotesk/500.css";
import "@fontsource/familjen-grotesk/600.css";
import "@fontsource/familjen-grotesk/700.css";
import "@fontsource/azeret-mono/400.css";
import "@fontsource/azeret-mono/500.css";
import "@fontsource/azeret-mono/600.css";
import "@fontsource/azeret-mono/700.css";
import "@/styles/tokens.css";

export const metadata: Metadata = {
  title: "NavigateNED — Campus Geodetic Survey & Routing System",
  description:
    "Georeferenced Outdoor & Multi-Floor Indoor Navigation, DSA Algorithm Visualizer, and Emergency Evacuation Planner for NED University of Engineering & Technology."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
