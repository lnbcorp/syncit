import type { Metadata } from "next";
import "./globals.css";

// Removed Google Fonts to reduce bundle size
// Using system font stack instead (defined in globals.css)

export const metadata: Metadata = {
  title: "PulseCast",
  description: "Create a room, share a 6-digit code, and broadcast live audio with perceptually zero lag",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div id="main-content">
          {children}
        </div>
      </body>
    </html>
  );
}
