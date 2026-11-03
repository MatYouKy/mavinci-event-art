import * as yup from 'yup';

// datetime-local uses local time. Reject impossible dates instead of letting Date
// silently move e.g. 31 February (or a missing DST hour) into another day/hour.
function validLocalDate(value: string | null | undefined): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  const date = new Date(value);
  return year >= 1000 && year <= 9999 && Number.isFinite(date.getTime()) &&
    date.getFullYear() === year && date.getMonth() === month - 1 &&
    date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute;
}

const optionalId = (message: string) => yup.string().trim().nullable()
  .transform((value) => value === '' ? null : value).uuid(message);
const localDate = yup.string().trim().test(
  'local-date', 'Wpisz poprawną datę i godzinę lub wybierz je z kalendarza.', validLocalDate,
);

export const eventWizardSchema = yup.object({
  name: yup.string().trim().required('Wpisz nazwę wydarzenia — same spacje nie wystarczą.'),
  clientType: yup.string().oneOf(['business', 'individual'], 'Wybierz typ klienta: biznesowy lub indywidualny.')
    .required('Wybierz typ klienta: biznesowy lub indywidualny.'),
  my_company_id: optionalId('Wybierz ponownie firmę realizującą z listy.'),
  organization_id: optionalId('Wybierz organizację z listy wyników wyszukiwania.'),
  contact_person_id: optionalId('Wybierz osobę kontaktową z listy lub zapisz nową osobę.')
    .test('saved-contact', 'Zapisz nową osobę przyciskiem „Dodaj osobę kontaktową” albo zamknij jej formularz.',
      function () { return !this.options.context?.pendingContact; }),
  category_id: optionalId('Wybierz ponownie kategorię z listy.'),
  event_date: localDate.required('Podaj datę i godzinę rozpoczęcia wydarzenia.'),
  event_end_date: localDate.test('after-start', 'Zakończenie musi być późniejsze niż rozpoczęcie wydarzenia.',
    function (value) {
      const start = this.parent.event_date;
      return !value || !start || !validLocalDate(value) || !validLocalDate(start) ||
        new Date(value).getTime() > new Date(start).getTime();
    }),
  location: yup.string().trim().required('Wybierz lokalizację wydarzenia.'),
  location_id: optionalId('Wybierz ponownie zapisany obiekt z listy lokalizacji.'),
  // Room IDs belong to the location JSON, not a UUID foreign key.
  location_room_ids: yup.array().of(yup.string().trim().required('Wybierz ponownie sale realizacji.'))
    .test('location', 'Najpierw wybierz obiekt, a następnie jego sale.', function (value) {
      return !value?.length || !!this.parent.location_id;
    }),
  stage_room_id: yup.string().nullable().test('selected-room', 'Miejsce sceny / DJ-a musi należeć do wybranych sal.',
    function (value) { return !value || !!this.parent.location_room_ids?.includes(value); }),
  budget: yup.number().nullable().transform((_value, original) => {
    const text = String(original ?? '').trim().replace(',', '.');
    return text === '' ? null : /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
  }).typeError('Wpisz budżet jako nieujemną kwotę z maksymalnie dwoma miejscami po przecinku.')
    .min(0, 'Budżet nie może być ujemny.')
    .max(99999999.99, 'Budżet nie może przekraczać 99 999 999,99 zł.'),
  status: yup.string().required('Wybierz status wydarzenia.').test('known-status', 'Wybierz status z listy.',
    function (value) { return !!value && !!this.options.context?.statuses?.includes(value); }),
});

export type ValidatedEventDetails = yup.InferType<typeof eventWizardSchema>;
export const eventContactSchema = yup.object({
  first_name: yup.string().trim().required('Wpisz imię osoby kontaktowej.'),
  last_name: yup.string().trim().required('Wpisz nazwisko osoby kontaktowej.'),
  email: yup.string().trim().email('Wpisz poprawny adres e-mail, np. imie@firma.pl.'),
  phone: yup.string().trim(),
});

export function getValidationErrors(schema: yup.AnyObjectSchema, value: unknown, context?: Record<string, unknown>): Record<string, string> {
  try {
    schema.validateSync(value, { abortEarly: false, context });
    return {};
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;
    const errors: Record<string, string> = {};
    for (const issue of error.inner.length ? error.inner : [error]) {
      const path = issue.path?.split('[')[0];
      if (path && !errors[path]) errors[path] = issue.message;
    }
    return errors;
  }
}

export function eventSaveError(error: unknown): { message: string; details: string } {
  const value = error as { code?: string; status?: string; message?: string; error?: string; details?: string };
  const code = value?.code;
  const details = [code, value?.message || value?.error, value?.details].filter(Boolean).join(' — ');
  let message = 'Serwer nie zapisał wydarzenia. Dane formularza zostały zachowane. Przekaż szczegóły błędu administratorowi.';
  if (code === 'AUTH_REQUIRED') message = 'Sesja wygasła. Zaloguj się ponownie przed zapisem wydarzenia.';
  else if (code === 'EMPLOYEE_MISSING') message = 'Twoje konto nie ma powiązanego pracownika. Poproś administratora o uzupełnienie powiązania.';
  else if (code === '42501') message = 'Nie masz uprawnień do zapisu wydarzenia lub powiązanych danych. Poproś administratora o sprawdzenie dostępu.';
  else if (code === '23503') message = 'Nie udało się zapisać powiązania w bazie. Wybrany rekord mógł zostać usunięty lub zmieniony. Wybierz go ponownie; jeśli błąd wraca, przekaż szczegóły administratorowi.';
  else if (code === '23505') message = 'Zapis koliduje z istniejącym rekordem. Sprawdź listę wydarzeń przed ponowną próbą; jeśli wydarzenia nie ma, przekaż szczegóły administratorowi.';
  else if (value?.status === 'FETCH_ERROR' || code === '57014') message = 'Nie udało się potwierdzić zapisu. Sprawdź listę wydarzeń przed ponowną próbą, aby nie utworzyć duplikatu. Dane formularza zostały zachowane.';
  return { message, details };
}
