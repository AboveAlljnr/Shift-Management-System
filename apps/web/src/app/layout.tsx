import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { Providers } from '@/components/providers';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: {
    default: 'ShiftMS — Workforce Management',
    template: '%s | ShiftMS',
  },
  description:
    'Modern workforce management platform for shift scheduling, attendance tracking, and team coordination.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ShiftMS' },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'ShiftMS',
    title: 'ShiftMS — Workforce Management',
    description: 'Modern workforce management platform.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
