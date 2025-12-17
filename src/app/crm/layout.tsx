// src/app/crm/layout.tsx
import type { Metadata } from 'next';
import CRMClientLayout from './CRMClientLayout';


export const metadata: Metadata = {
  title: 'Mavinci CRM',
  description: 'Mavinci CRM',
  robots: { index: false, follow: false },
};

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <CRMClientLayout>{children}</CRMClientLayout>;
}