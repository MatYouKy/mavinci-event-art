import * as yup from 'yup';
export const settlementLabels: Record<string, string> = {
  invoice_vat: 'Faktura VAT',
  invoice_no_vat: 'Faktura bez VAT',
  cash: 'Gotówka',
  civil_contract: 'Umowa zlecenie',
  other: 'Inna forma',
};
export function validNip(value: string) {
  const digits = value.replace(/[\s-]/g, '');
  return (
    /^\d{10}$/.test(digits) && !/^(\d)\1{9}$/.test(digits) &&
    [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce((sum, w, i) => sum + w * Number(digits[i]), 0) % 11 ===
      Number(digits[9])
  );
}
export const subcontractorProfileSchema = yup
  .object({
    company_name: yup.string().trim().required('Podaj nazwę lub imię i nazwisko.'),
    default_settlement_type: yup
      .string()
      .oneOf(['invoice_vat', 'invoice_no_vat', 'cash', 'civil_contract'])
      .required('Wybierz formę rozliczenia.'),
    specialization: yup.string().optional(),
    personnel_identifier: yup.string().test('pesel','PESEL musi zawierać 11 cyfr i prawidłową sumę kontrolną.',function(v) {
      if(this.parent.default_settlement_type!=='civil_contract'||!v?.trim())return true;
      const n=v.replace(/\s/g,'');
      return /^\d{11}$/.test(n) && !/^(\d)\1{10}$/.test(n) && (10-[1,3,7,9,1,3,7,9,1,3].reduce((s,w,i)=>s+w*Number(n[i]),0)%10)%10===Number(n[10]);
    }),
    personnel_address_parts: yup.object({
      type: yup.string().oneOf(['','street','avenue','square','village','estate']),
      name: yup.string().max(200,'Nazwa może mieć maksymalnie 200 znaków.'),
      house: yup.string().max(30,'Numer domu może mieć maksymalnie 30 znaków.'),
      apartment: yup.string().max(30,'Numer mieszkania może mieć maksymalnie 30 znaków.'),
      city: yup.string().max(200,'Miejscowość może mieć maksymalnie 200 znaków.'),
      country: yup.string().max(100,'Kraj może mieć maksymalnie 100 znaków.'),
      postal_code: yup.string().test('postal','Podaj kod pocztowy w formacie 00-000.',function(v){
        return !v?.trim() || !['polska','pl',''].includes((this.parent.country || '').trim().toLowerCase()) || /^\d{2}-\d{3}$/.test(v.trim());
      }),
    }).optional(),
    personnel_address: yup.string().max(1000,'Adres może mieć maksymalnie 1000 znaków.'),
    personnel_bank_account: yup.string().test('iban','Sprawdź format i sumę kontrolną numeru konta.',function(v) {
      if(this.parent.default_settlement_type!=='civil_contract'||!v?.trim())return true;
      const raw=v.replace(/\s/g,'').toUpperCase();const iban=/^\d{26}$/.test(raw)?'PL'+raw:raw;
      if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith('PL')&&iban.length!==28))return false;
      let remainder=0;for(const char of iban.slice(4)+iban.slice(0,4)){for(const digit of (/\d/.test(char)?char:String(char.charCodeAt(0)-55)))remainder=(remainder*10+Number(digit))%97;}return remainder===1;
    }),
    email: yup.string().trim().email('Podaj poprawny adres e-mail.'),
    phone: yup.string().trim(),
    nip: yup
      .string()
      .when('default_settlement_type', {
        is: (v: string) => String(v).startsWith('invoice'),
        then: (s) =>
          s
            .required('Do rozliczenia fakturą podaj NIP.')
            .test('nip', 'NIP ma nieprawidłowy format lub sumę kontrolną.', (v) =>
              validNip(v || ''),
            ),
        otherwise: (s) => s.optional(),
      }),
  })
  .test('contact', 'Podaj telefon lub e-mail.', function (v) {
    return (
      !!(v.phone || v.email) ||
      this.createError({ path: 'phone', message: 'Podaj telefon lub e-mail.' })
    );
  });
