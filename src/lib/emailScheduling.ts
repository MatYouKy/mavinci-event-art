export type CrmEmailFunction = 'send-email' | 'send-offer-email' | 'send-invoice-email';

export interface EmailDeliveryDraft {
  deliveryMode?: 'now' | 'scheduled';
  scheduledAt?: string;
}

export interface CrmEmailScheduleMetadata {
  entityType?: 'offer' | 'contract' | 'calculation' | 'invoice' | 'inquiry' | 'contact' | 'message';
  entityId?: string;
  markEntitySent?: boolean;
  draft?: boolean;
  inquiryId?: string;
  eventId?: string | null;
  actionUrl?: string;
}

interface DispatchCrmEmailOptions {
  accessToken: string;
  functionName: CrmEmailFunction;
  payload: Record<string, unknown>;
  scheduledAt?: string | null;
  metadata?: CrmEmailScheduleMetadata;
}

export interface DispatchCrmEmailResult {
  success: boolean;
  scheduled: boolean;
  scheduledAt?: string;
  scheduledEmailId?: string;
  [key: string]: unknown;
}

const warsawLocalDateTimeToIso = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Podaj prawidłową datę i godzinę wysyłki');
  const [, year, month, day, hour, minute] = match;
  const requestedUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const getOffset = (instant: number) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    return representedUtc - instant;
  };
  const firstPass = requestedUtc - getOffset(requestedUtc);
  return new Date(requestedUtc - getOffset(firstPass)).toISOString();
};

export const resolveScheduledEmailDate = (draft: EmailDeliveryDraft): string | null => {
  if (draft.deliveryMode !== 'scheduled') return null;
  if (!draft.scheduledAt) throw new Error('Wybierz datę i godzinę wysyłki');

  const date = new Date(warsawLocalDateTimeToIso(draft.scheduledAt));
  if (Number.isNaN(date.getTime())) throw new Error('Podaj prawidłową datę i godzinę wysyłki');
  if (date.getTime() < Date.now() + 30_000) {
    throw new Error('Termin wysyłki musi przypadać w przyszłości');
  }
  return date.toISOString();
};

export const formatScheduledEmailDate = (value: string): string =>
  new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(value));

export const dispatchCrmEmail = async ({
  accessToken,
  functionName,
  payload,
  scheduledAt,
  metadata,
}: DispatchCrmEmailOptions): Promise<DispatchCrmEmailResult> => {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new Error('Brak konfiguracji serwera pocztowego');

  const isScheduled = Boolean(scheduledAt);
  const response = await fetch(
    `${baseUrl}/functions/v1/${isScheduled ? 'schedule-email' : functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(
        isScheduled
          ? {
              functionName,
              scheduledAt,
              timezone: 'Europe/Warsaw',
              payload,
              metadata: metadata || {},
            }
          : payload,
      ),
    },
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success === false) {
    throw new Error(result?.error || result?.message || 'Nie udało się wysłać wiadomości');
  }
  return {
    ...result,
    success: true,
    scheduled: isScheduled,
    scheduledAt: scheduledAt || undefined,
  };
};
