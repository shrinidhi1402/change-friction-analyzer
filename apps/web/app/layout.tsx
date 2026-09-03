import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '../lib/AuthContext';

export const metadata: Metadata = {
  title: 'Change Friction Analyzer',
  description: 'Developer intelligence for change risk',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
