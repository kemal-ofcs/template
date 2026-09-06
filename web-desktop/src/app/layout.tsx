import type { Metadata } from "next";
import { AuthProvider } from "@/lib/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "App Template",
    template: "%s · App Template",
  },
  description:
    "Sistem operasional operasional CONTOH untuk Web dan Desktop dengan dukungan online dan offline.",
  applicationName: "App Template",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
