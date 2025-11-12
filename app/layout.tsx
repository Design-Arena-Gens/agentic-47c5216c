import type { Metadata } from 'next';
import './globals.css';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'YouTube Autopilot Uploader',
  description: 'Client-side YouTube uploader with scheduling and progress',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
        />
      </head>
      <body>
        <div className="container">
          <header className="header">
            <h1>YouTube Autopilot Uploader</h1>
            <p className="sub">Authorize with Google, upload, and schedule videos.</p>
          </header>
          <main>{children}</main>
          <footer className="footer">Built for automation. No server file limits.</footer>
        </div>
      </body>
    </html>
  );
}
