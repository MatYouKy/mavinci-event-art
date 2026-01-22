'use client';

import React, { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { updateEmployeePreferences } from '@/app/(crm)/crm/actions/preferences.actions';


type ViewMode = 'list' | 'grid' | 'cards' | 'detailed';

interface ViewModePreference {
  viewMode: ViewMode;
}

interface NotificationPreferences {
  email: boolean;
  push: boolean;
  categories: {
    messages: boolean;
    events: boolean;
    tasks: boolean;
    clients: boolean;
    equipment: boolean;
  };
}

export interface Preferences {
  clients?: ViewModePreference;
  equipment?: ViewModePreference;
  events?: ViewModePreference;
  tasks?: ViewModePreference;
  offers?: ViewModePreference;
  contracts?: ViewModePreference;
  fleet?: ViewModePreference;
  employees?: ViewModePreference;
  notifications?: NotificationPreferences;
}

const defaultNotifications: NotificationPreferences = {
  email: true,
  push: false,
  categories: { messages: true, events: true, tasks: true, clients: true, equipment: true },
};

type Ctx = {
  employeeId: string;
  preferences: Preferences;
  loading: boolean;
  getViewMode: (module: keyof Preferences) => ViewMode;
  setViewMode: (module: keyof Preferences, viewMode: ViewMode) => void;
  getNotificationSettings: () => NotificationPreferences;
  refetch: () => void; // opcjonalnie noop
};

const PreferencesContext = createContext<Ctx | null>(null);

export default function PreferencesClientProvider({
  employeeId,
  initialPreferences,
  children,
}: {
  employeeId: string;
  initialPreferences: Preferences;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences ?? {});
  const [isPending, startTransition] = useTransition();

  const getViewMode = (module: keyof Preferences): ViewMode =>
    (preferences[module] as any)?.viewMode || 'cards';

  const setViewMode = (module: keyof Preferences, viewMode: ViewMode) => {
    const next = { ...preferences, [module]: { viewMode } };

    // optimistic update (zero migania)
    setPreferences(next);

    startTransition(async () => {
      try {
        await updateEmployeePreferences(employeeId, next);
      } catch (e) {
        // w razie błędu możesz cofnąć albo pokazać snackbar
        // setPreferences(preferences);  // opcjonalny rollback
        console.error('Error updating view mode:', e);
      }
    });
  };

  const getNotificationSettings = () => preferences.notifications ?? defaultNotifications;

  const value = useMemo<Ctx>(
    () => ({
      employeeId,
      preferences,
      loading: isPending,
      getViewMode,
      setViewMode,
      getNotificationSettings,
      refetch: () => {}, // już nie fetchujemy w hooku
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employeeId, preferences, isPending],
  );

  return (
    <PreferencesContext.Provider value={value}>
     {children}
    </PreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('useUserPreferences must be used within PreferencesClientProvider');
  return ctx;
}
