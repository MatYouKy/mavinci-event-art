import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from './useCurrentEmployee';

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

interface Preferences {
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

export function useUserPreferences() {
  const { employee } = useCurrentEmployee();
  const [preferences, setPreferences] = useState<Preferences>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (employee) {
      fetchPreferences();
    }
  }, [employee]);

  const fetchPreferences = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('preferences')
        .eq('id', employee?.id)
        .single();

      if (error) throw error;

      setPreferences(data?.preferences || {});
    } catch (err) {
      console.error('Error fetching preferences:', err);
    } finally {
      setLoading(false);
    }
  };

  const getViewMode = (module: string): ViewMode => {
    // Ensure we only read .viewMode from modules supporting ViewModePreference
    const viewModeModules: Array<keyof Preferences> = [
      'clients',
      'equipment',
      'events',
      'tasks',
      'offers',
      'contracts',
      'fleet',
      'employees',
    ];
    if (viewModeModules.includes(module as keyof Preferences)) {
      const pref = preferences[module as keyof Preferences] as ViewModePreference | undefined;
      return pref?.viewMode || 'cards';
    }
    return 'cards';
  };

  const setViewMode = async (module: string, viewMode: ViewMode) => {
    // Only apply setViewMode to eligible modules
    const viewModeModules: Array<keyof Preferences> = [
      'clients',
      'equipment',
      'events',
      'tasks',
      'offers',
      'contracts',
      'fleet',
      'employees',
    ];
    if (!viewModeModules.includes(module as keyof Preferences)) {
      return;
    }
    const newPreferences = {
      ...preferences,
      [module]: { viewMode },
    };

    try {
      const { error } = await supabase
        .from('employees')
        .update({ preferences: newPreferences })
        .eq('id', employee?.id);

      if (error) throw error;

      setPreferences(newPreferences);
    } catch (err) {
      console.error('Error updating view mode:', err);
    }
  };

  const getNotificationSettings = (): NotificationPreferences => {
    return (
      preferences.notifications || {
        email: true,
        push: false,
        categories: {
          messages: true,
          events: true,
          tasks: true,
          clients: true,
          equipment: true,
        },
      }
    );
  };

  return {
    preferences,
    loading,
    getViewMode,
    setViewMode,
    getNotificationSettings,
    refetch: fetchPreferences,
  };
}
