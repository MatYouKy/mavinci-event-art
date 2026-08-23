// src/app/crm/layout.tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import '@/index.css';

import CRMClientLayout from './CRMClientLayout';
import PreferencesClientProvider from './PreferencesClientProvider';
import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import CrmProviders from './CrmProviders';
import { fetchUnreadCountServer } from '@/lib/CRM/messages/unreadCounter';
import { fetchNotificationsServer } from '@/lib/CRM/notifications/fetchNotificationsServer';
import { getNavigationForUserServer } from '@/lib/CRM/navigation/getNavigationForUser.server';
import { cookies } from 'next/headers';
import { GlobalLoaderProvider, RouteLoaderReset } from '@/contexts/GlobalLoaderContext';

export const metadata: Metadata = {
  title: 'Mavinci CRM',
  description: 'Mavinci CRM',
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: '/signature.png', type: 'image/png' }],
    shortcut: '/signature.png',
    apple: '/signature.png',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployeeServerCached();

  if (!employee?.id) {
    redirect('/login');
  }

  const initialUnreadMessagesCount = await fetchUnreadCountServer(employee.id);

  const preferences = await getEmployeePreferences();
  const cookieStore = cookies(); // ✅ w request scope
  const { notifications } = await fetchNotificationsServer(cookieStore, 100);

  const { navigation } = await getNavigationForUserServer();

  return (
    <html lang="pl">
      <body>
        <GlobalLoaderProvider>
          <RouteLoaderReset />
          <CrmProviders>
            <PreferencesClientProvider employeeId={employee.id} initialPreferences={preferences}>
              <CRMClientLayout
                employee={employee}
                initialUnreadMessagesCount={initialUnreadMessagesCount}
                initialNotifications={notifications}
                initialNavigation={navigation}
              >
                {children}
              </CRMClientLayout>
            </PreferencesClientProvider>
          </CrmProviders>
        </GlobalLoaderProvider>
      </body>
    </html>
  );
}
