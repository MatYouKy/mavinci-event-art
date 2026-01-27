/**
 * Utility functions for handling datetime conversions between UTC and local time
 * for datetime-local inputs
 */

/**
 * Converts UTC datetime string from database to local datetime string for datetime-local input
 * Example: "2024-01-27T17:00:00Z" (UTC) -> "2024-01-27T18:00" (CET/UTC+1)
 */
export function utcToLocalDatetimeString(utcDate: string | null | undefined): string {
  if (!utcDate) return '';

  const date = new Date(utcDate);

  // Check if date is valid
  if (isNaN(date.getTime())) return '';

  // Get timezone offset in minutes (e.g., -60 for CET in winter, -120 for CEST in summer)
  const offset = date.getTimezoneOffset();

  // Adjust date by subtracting the offset to get local time
  const localDate = new Date(date.getTime() - offset * 60 * 1000);

  // Return in YYYY-MM-DDTHH:mm format (required by datetime-local input)
  return localDate.toISOString().slice(0, 16);
}

/**
 * Converts local datetime string from datetime-local input to UTC ISO string for database
 * Example: "2024-01-27T18:00" (local) -> "2024-01-27T17:00:00.000Z" (UTC)
 *
 * IMPORTANT: This assumes the input value is in the user's local timezone (Poland)
 */
export function localDatetimeStringToUTC(localDatetime: string | null | undefined): string | null {
  if (!localDatetime) return null;

  // datetime-local returns format: "2024-01-27T18:00"
  // Create Date object - it will be interpreted as local time
  const date = new Date(localDatetime);

  // Check if date is valid
  if (isNaN(date.getTime())) return null;

  // Convert to UTC ISO string for database
  return date.toISOString();
}

/**
 * Gets current date and time in local timezone formatted for datetime-local input
 */
export function getCurrentLocalDatetimeString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

/**
 * Formats a UTC date string to Polish locale date/time display
 * Example: "2024-01-27T17:00:00Z" -> "27.01.2024, 18:00"
 */
export function formatDateTimeForDisplay(utcDate: string | null | undefined, includeTime = true): string {
  if (!utcDate) return '-';

  const date = new Date(utcDate);

  if (isNaN(date.getTime())) return '-';

  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime && {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };

  return date.toLocaleString('pl-PL', options);
}

/**
 * Formats date only without time
 * Example: "2024-01-27T17:00:00Z" -> "27.01.2024"
 */
export function formatDateForDisplay(utcDate: string | null | undefined): string {
  return formatDateTimeForDisplay(utcDate, false);
}
