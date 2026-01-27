import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-export date/time utilities for convenience
export {
  utcToLocalDatetimeString,
  localDatetimeStringToUTC,
  getCurrentLocalDatetimeString,
  formatDateTimeForDisplay,
  formatDateForDisplay,
} from './utils/dateTimeUtils';
