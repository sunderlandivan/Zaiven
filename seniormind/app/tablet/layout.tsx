import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "SeniorMind Tablet",
  description: "AI companion for residents",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SeniorMind",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1e3a5f",
};

export default function TabletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh w-full overflow-hidden bg-seniormind-navy">
      {children}
    </div>
  );
}
