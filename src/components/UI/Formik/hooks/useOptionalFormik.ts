// utils/useOptionalFormik.ts
'use client';
import { useContext } from 'react';
import { FormikContext, type FormikContextType } from 'formik';

export function useOptionalFormik<T = any>(): FormikContextType<T> | null {
  // bez ostrzeżeń – zwykły useContext zamiast useFormikContext()
  const ctx = useContext(FormikContext as unknown as React.Context<FormikContextType<T> | null>);
  return ctx ?? null;
}