import React from 'react'
import { KitsPageClient } from './KitsPageClient'
import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import { ViewMode } from '../../settings/page';

export default async function KitsPageServer() {
  const preferences = await getEmployeePreferences();
  return (
    <KitsPageClient viewMode={preferences.kits?.viewMode as ViewMode} />
  )
}