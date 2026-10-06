import * as yup from 'yup';
import { validNip } from './profileValidation';
const money = yup
  .number()
  .typeError('Wpisz prawidłową liczbę')
  .min(0, 'Wartość nie może być ujemna')
  .required('Wpisz wartość');
export const subcontractorTaskSchema = yup.object({
  providerMode: yup.string().oneOf(['existing', 'quick']).required(),
  subcontractor_id: yup
    .string()
    .when('providerMode', { is: 'existing', then: (s) => s.required('Wybierz podwykonawcę') }),
  company_name: yup
    .string()
    .trim()
    .when('providerMode', {
      is: 'quick',
      then: (s) => s.required('Podaj nazwę firmy lub imię i nazwisko podwykonawcy'),
    }),
  nip: yup.string().test('invoice-nip', 'Do faktury podaj poprawny NIP.', function(value) { return this.parent.providerMode !== 'quick' || !String(this.parent.settlement_type).startsWith('invoice') || validNip(value||''); }),
  settlement_type: yup.string().test('mandate-onboarding', 'Dla nowego podwykonawcy na umowie zlecenia użyj pełnego kreatora podwykonawcy, a potem wybierz go z bazy.', function(value) { return this.parent.providerMode !== 'quick' || value !== 'civil_contract' || this.createError({path:'company_name', message:'Uzupełnij podwykonawcę i umowę zlecenia w pełnym kreatorze, a następnie wybierz go z bazy.'}); }),
  email: yup.string().trim().email('Wpisz prawidłowy adres e-mail'),
  phone: yup
    .string()
    .trim()
    .test(
      'phone',
      'Telefon powinien zawierać 9–15 cyfr, opcjonalnie +, spacje i nawiasy',
      (value) =>
        !value ||
        (/^[\d+()\s-]+$/.test(value) &&
          value.replace(/\D/g, '').length >= 9 &&
          value.replace(/\D/g, '').length <= 15),
    ),
  task_name: yup
    .string()
    .trim()
    .required('Podaj nazwę zlecenia')
    .max(250, 'Nazwa może mieć maksymalnie 250 znaków'),
  scope_of_work: yup.string().max(6000, 'Zakres może mieć maksymalnie 6000 znaków'),
  deliverables: yup.string().max(4000, 'Oczekiwany rezultat może mieć maksymalnie 4000 znaków'),
  guidelines: yup.string().max(6000, 'Wytyczne mogą mieć maksymalnie 6000 znaków'),
  scheduled_start: yup
    .string()
    .test('date', 'Wpisz poprawny termin rozpoczęcia', (v) => !v || Number.isFinite(Date.parse(v))),
  scheduled_end: yup
    .string()
    .test('date', 'Wpisz poprawny termin zakończenia', (v) => !v || Number.isFinite(Date.parse(v)))
    .test('order', 'Zakończenie musi być późniejsze niż rozpoczęcie', function (v) {
      return (
        !v ||
        !this.parent.scheduled_start ||
        Date.parse(v) > Date.parse(this.parent.scheduled_start)
      );
    }),
  estimated_hours: money,
  actual_hours: money,
  hourly_rate: yup.mixed().when('payment_type', {
    is: (type: string) => type === 'hourly' || type === 'mixed',
    then: () => money,
    otherwise: (schema) => schema.nullable().notRequired(),
  }),
  fixed_price: yup.mixed().when('payment_type', {
    is: (type: string) => type === 'fixed' || type === 'mixed',
    then: () => money,
    otherwise: (schema) => schema.nullable().notRequired(),
  }),
  agreed_cost: money,
  createContract: yup.boolean(),
  contract_value: yup.mixed().when('createContract', {
    is: true,
    then: () => money,
    otherwise: (schema) => schema.nullable().notRequired(),
  }),
  contractFile: yup
    .mixed<File>()
    .nullable()
    .test('file', 'Dodaj plik umowy podwykonawcy', function (v) {
      return !this.parent.createContract || !!v;
    })
    .test(
      'size',
      'Plik umowy może mieć maksymalnie 15 MB',
      function (v) {
        return !this.parent.createContract || !v || v.size <= 15 * 1024 * 1024;
      },
    ),
});
