/** Supabase HTTP errors carry a Response; network errors carry a native Error instead. */
export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!error || typeof error !== 'object') return fallback;
  const value = error as { name?: string; message?: string; context?: unknown };
  if (value.name === 'FunctionsFetchError')
    return 'Nie udało się połączyć z funkcją Supabase. Sprawdź połączenie i dostępność funkcji na serwerze, a następnie spróbuj ponownie.';
  if (value.name === 'FunctionsRelayError')
    return 'Serwer nie mógł przekazać żądania do funkcji Supabase. Spróbuj ponownie.';
  const context = value.context;
  let status: number | undefined;
  let body: unknown;
  if (context && typeof context === 'object') {
    const response = context as {
      status?: number;
      clone?: () => { json?: () => Promise<unknown> };
      json?: () => Promise<unknown>;
    };
    status = response.status;
    try {
      const readable = typeof response.clone === 'function' ? response.clone() : response;
      body = typeof readable.json === 'function' ? await readable.json() : context;
    } catch {
      // Empty, malformed or already-consumed responses must not hide the original error.
    }
  }
  const details =
    body && typeof body === 'object'
      ? (body as { error?: unknown; message?: unknown; code?: unknown })
      : null;
  if (details?.code === 'NOT_FOUND')
    return 'Generator nie jest jeszcze dostępny na serwerze. Wymagane jest wdrożenie funkcji Supabase.';
  if (status === 401) return 'Sesja wygasła lub jest nieprawidłowa. Zaloguj się ponownie.';
  if (typeof details?.error === 'string' && details.error) return details.error;
  if (status === 403) return 'Nie masz uprawnień do tej operacji.';
  if (typeof details?.message === 'string' && details.message) return details.message;
  if (value.name === 'FunctionsHttpError') return fallback;
  return typeof value.message === 'string' && value.message ? value.message : fallback;
}
