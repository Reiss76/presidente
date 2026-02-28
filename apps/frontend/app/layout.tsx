import type { Metadata, Viewport } from 'next';
import './globals.css';
import ClientErrorReporter from './components/ClientErrorReporter';

export const metadata: Metadata = {
  title: 'CosmosX · Buscador de códigos',
  description:
    'Buscador y panel administrativo para consultar y actualizar códigos, razones sociales y domicilios.',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        {/* 👇 Punto 4 nuevamente por si el navegador no toma metadata.other */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="theme-color" content="#000000" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>

      <body>
        <ClientErrorReporter />
        {children}
      </body>
    </html>
  );
}
