import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { SerializedError } from '@reduxjs/toolkit';

function isFetchBaseQueryError(error: unknown): error is FetchBaseQueryError {
  return typeof error === 'object' && error !== null && 'status' in error;
}

function isSerializedError(error: unknown): error is SerializedError {
  return typeof error === 'object' && error !== null && 'message' in error;
}

export function getRtkErrorMessage(error: unknown): string | null {
  if (!error) return null;

  // 1) fetchBaseQuery error
  if (isFetchBaseQueryError(error)) {
    // czasem jest error.error (string)
    if (typeof (error as any).error === 'string') return (error as any).error;

    // często backend zwraca { message } w data
    const data = (error as any).data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }

    // fallback
    if (typeof error.status === 'string') return error.status;
    if (typeof error.status === 'number') return `Błąd ${error.status}`;
    return 'Wystąpił błąd zapytania';
  }

  // 2) serialized error
  if (isSerializedError(error)) {
    return typeof error.message === 'string' ? error.message : 'Wystąpił błąd';
  }

  return 'Wystąpił błąd';
}