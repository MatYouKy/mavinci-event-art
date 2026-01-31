// src/app/crm/layout.tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import '@/index.css';

import CRMClientLayout from './CRMClientLayout';
import PreferencesClientProvider from './PreferencesClientProvider';
import { getEmployeePreferencesCached } from '@/lib/CRM/employees/getEmployeePreferences';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import CrmProviders from './CrmProviders';
import { fetchUnreadCountServer } from '@/lib/CRM/messages/unreadCounter';
import { fetchNotificationsServer } from '@/lib/CRM/notifications/fetchNotificationsServer';
import { getNavigationForUserServer } from '@/lib/CRM/navigation/getNavigationForUser.server';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'Mavinci CRM',
  description: 'Mavinci CRM',
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: '/shape-mavinci.svg', type: 'image/svg+xml' }],
    shortcut: '/shape-mavinci.svg',
    apple: '/shape-mavinci.svg',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployeeServerCached();
  const initialUnreadMessagesCount = await fetchUnreadCountServer(); // pobieramy liczbę nieprzeczytanych wiadomości na początku

  if (!employee?.id) {
    redirect('/login');
  }

  const preferences = await getEmployeePreferencesCached(employee.id);
  const cookieStore = cookies(); // ✅ w request scope
  const { notifications, unreadCount } = await fetchNotificationsServer(cookieStore, 100);

  const { navigation, employeeId } = await getNavigationForUserServer();

  console.log(navigation);

  return (
    <html lang="pl">
      <body>
        <CrmProviders>
          <PreferencesClientProvider employeeId={employee.id} initialPreferences={preferences}>
            <CRMClientLayout
              employee={employee}
              initialUnreadMessagesCount={unreadCount}
              initialNotifications={notifications}
              initialNavigation={navigation}
            >
              {children}
            </CRMClientLayout>
          </PreferencesClientProvider>
        </CrmProviders>
      </body>
    </html>
  );
}
