/**
 * Helper functions for getting notification email addresses based on employee preferences
 */

import { supabase } from './supabase';

export interface EmployeeNotificationEmails {
  employeeId: string;
  emails: string[];
  preference: 'work' | 'personal' | 'both' | 'none';
}

/**
 * Get notification email addresses for an employee based on their preferences
 * @param employeeId - UUID of the employee
 * @returns Object containing employee ID, list of emails to send to, and the preference
 */
export async function getEmployeeNotificationEmails(
  employeeId: string
): Promise<EmployeeNotificationEmails> {
  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, email, personal_email, notification_email_preference')
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !employee) {
    console.error('Error fetching employee notification preferences:', error);
    return {
      employeeId,
      emails: [],
      preference: 'none',
    };
  }

  const emails: string[] = [];
  const preference = employee.notification_email_preference || 'work';

  switch (preference) {
    case 'work':
      if (employee.email) {
        emails.push(employee.email);
      }
      break;

    case 'personal':
      if (employee.personal_email) {
        emails.push(employee.personal_email);
      }
      break;

    case 'both':
      if (employee.email) {
        emails.push(employee.email);
      }
      if (employee.personal_email) {
        emails.push(employee.personal_email);
      }
      break;

    case 'none':
      // No emails to send
      break;

    default:
      // Default to work email if preference is unknown
      if (employee.email) {
        emails.push(employee.email);
      }
  }

  return {
    employeeId,
    emails,
    preference,
  };
}

/**
 * Get notification emails for multiple employees
 * @param employeeIds - Array of employee UUIDs
 * @returns Array of employee notification email objects
 */
export async function getMultipleEmployeeNotificationEmails(
  employeeIds: string[]
): Promise<EmployeeNotificationEmails[]> {
  const results = await Promise.all(
    employeeIds.map((id) => getEmployeeNotificationEmails(id))
  );

  return results;
}

/**
 * Get all unique email addresses from an array of employee notification results
 * @param notifications - Array of EmployeeNotificationEmails
 * @returns Array of unique email addresses
 */
export function getAllUniqueEmails(notifications: EmployeeNotificationEmails[]): string[] {
  const allEmails = notifications.flatMap((n) => n.emails);
  return Array.from(new Set(allEmails));
}
