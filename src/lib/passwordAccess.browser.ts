'use client';

import { supabase } from '@/lib/supabase/browser';
import type { PasswordAccessType } from '@/lib/passwordAccess';

// React Strict Mode uruchamia efekt ponownie. Drugie wywołanie korzysta z tej
// samej odpowiedzi zamiast drugi raz zużywać jednorazowy token zaproszenia.
const pendingVerifications = new Map<string, ReturnType<typeof supabase.auth.verifyOtp>>();

export function verifyPasswordAccessToken(tokenHash: string, type: PasswordAccessType) {
  const key = `${type}:${tokenHash}`;
  const pending = pendingVerifications.get(key);
  if (pending) return pending;

  const verification = supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    .finally(() => { pendingVerifications.delete(key); });
  pendingVerifications.set(key, verification);
  return verification;
}
