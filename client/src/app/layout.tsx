import type { Metadata } from "next";
import { Bebas_Neue, Comfortaa } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas",
  subsets: ["latin"],
});

const comfortaa = Comfortaa({
  weight: "400",
  variable: "--font-comfortaa",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TAPRI - Contemporary Indie Radio",
  description: "A synchronized, real-time contemporary indie radio experience.",
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode;}>) {
  return (
    <html
      lang="en"
      className={`${bebas.variable} ${comfortaa.variable} h-full`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
