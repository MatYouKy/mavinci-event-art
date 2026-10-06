import { assessQuestionnaire, profileFromQuestionnaire, validQuestionDate, type WizardIssue } from './questionnaire';
import type { PersonnelPayrollProfile } from './legal';
import type { NetCostSettings } from './netCostEstimate';
import { getTimeEvidenceMethod, type PersonnelDocumentDetails } from './documentFields';

type ContractWizardForm = {
  my_company_id:string;party_name:string;party_kind:string;party_address:string;party_bank_account:string;
  link_type:string;employee_id:string;person_id:string;subcontractor_id:string;
  contract_kind:string;agreement_form:string;payment_method:string;contract_term:string;term_ended:boolean;
  signed_date:string;start_date:string;end_date:string;engagement_scope:string;event_id:string;settlement_cycle:string;
  issuer_representative:string;work_scope:string;payment_terms:string;title:string;currency:string;planned_net_amount:string;
  payroll_profile:PersonnelPayrollProfile;net_cost_settings:NetCostSettings;document_details:PersonnelDocumentDetails;
};
export function contractWizardIssues(f:ContractWizardForm):WizardIssue[] {
  const issues:WizardIssue[]=[];
  const add=(step:number,key:string,message:string)=>issues.push({step,key,message});
  if(!f.my_company_id)add(0,'company','Wybierz działalność zawierającą umowę.');
  if(!f.party_name.trim())add(0,'name','Podaj imię i nazwisko albo nazwę strony umowy.');
  if(!f.party_kind)add(0,'party_kind','Wskaż, czy stroną jest osoba, czy firma.');
  if(!f.title.trim())add(0,'title','Podaj tytuł umowy.');
  if(f.link_type==='employee'&&!f.employee_id||f.link_type==='person'&&!f.person_id||f.link_type==='subcontractor'&&!f.subcontractor_id)add(0,'link','Wybierz osobę z bazy lub wpisz ją bez powiązania z CRM.');
  if(!validQuestionDate(f.signed_date))add(1,'signed_date','Podaj prawidłową datę zawarcia.');
  if(!f.party_address.trim())add(1,'address','Podaj adres strony umowy.');
  if(!f.issuer_representative.trim())add(1,'representative','Podaj osobę reprezentującą działalność.');
  if(!f.work_scope.trim())add(1,'scope','Opisz czynności albo konkretny rezultat dzieła.');
  if(!f.payment_terms.trim())add(1,'terms','Określ termin i warunki płatności.');
  if(!['fixed','indefinite'].includes(f.contract_term))add(1,'term','Wybierz czas trwania umowy.');
  if(!validQuestionDate(f.start_date))add(1,'start','Podaj prawidłowy początek umowy.');
  if((f.contract_term==='fixed'||f.term_ended)&&(!validQuestionDate(f.end_date)||f.end_date<f.start_date))add(1,'end','Podaj prawidłowy koniec umowy, nie wcześniejszy od początku.');
  if(f.engagement_scope==='event'&&(!f.event_id||f.contract_term!=='fixed'))add(1,'event','Jedna realizacja wymaga wybranego wydarzenia i okresu od–do.');
  if(f.settlement_cycle==='on_completion'&&(!f.end_date||f.start_date.slice(0,7)!==f.end_date.slice(0,7)))add(1,'cycle','Pracę na przełomie miesięcy rozliczaj miesięcznie.');
  if(f.contract_kind==='employment'&&f.agreement_form!=='written')add(1,'written','Etat wymaga pisemnych warunków zatrudnienia.');
  if(f.agreement_form==='oral'&&!f.payroll_profile.oral_confirmed)add(1,'oral','Potwierdź dopuszczalność formy ustnej. Gotówka nie zmienia podatków ani składek.');
  if(f.payment_method==='cash'&&f.contract_kind==='employment'&&!f.payroll_profile.cash_requested)add(1,'cash','Wypłata gotówką przy etacie wymaga wniosku pracownika.');
  if(f.payment_method==='bank') {
    const bank=f.party_bank_account.replace(/\s/g,'').toUpperCase();
    if(!bank)add(1,'bank','Podaj rachunek do wypłaty.');
    else {
      const iban=/^\d{26}$/.test(bank)?'PL'+bank:bank;
      if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith('PL')&&iban.length!==28))add(1,'bank','Wpisz poprawny rachunek w formacie IBAN (polski: 26 cyfr lub PL i 26 cyfr).');
      else {let remainder=0;for(const char of iban.slice(4)+iban.slice(0,4)){for(const digit of (/\d/.test(char)?char:String(char.charCodeAt(0)-55)))remainder=(remainder*10+Number(digit))%97;}if(remainder!==1)add(1,'bank','Suma kontrolna rachunku jest niepoprawna. Sprawdź numer z dokumentem osoby.');}
    }
  }
  const d=f.document_details;
  if(d.party_address_parts) {
    const address=d.party_address_parts;
    if(!address.name.trim())add(1,'address_name','Podaj nazwę ulicy, placu albo wsi.');
    if(!address.house.trim())add(1,'address_house','Podaj numer budynku.');
    if(!address.city.trim())add(1,'address_city','Podaj miejscowość adresu.');
    if(!address.country.trim())add(1,'address_country','Podaj kraj adresu.');
    if(!address.postal_code.trim())add(1,'address_postal','Podaj kod pocztowy.');
    else if(['polska','pl'].includes(address.country.trim().toLowerCase())&&!/^\d{2}-\d{3}$/.test(address.postal_code.trim()))add(1,'address_postal','Podaj kod pocztowy w formacie 00-000.');
  }
  if(f.contract_kind==='mandate') {
    const method=getTimeEvidenceMethod(d);
    if(method==='other'&&!d.time_evidence.trim())add(1,'time_evidence','Opisz inny sposób potwierdzania godzin.');
    if(method==='crm'&&!f.employee_id)add(0,'time_evidence_employee','System CRM wymaga powiązania osoby z kontem pracownika. Możesz wcześniej zapisać szkic.');
  }
  if(!d.work_place.trim())add(1,'place','Podaj miejsce pracy lub przekazania dzieła.');
  if(f.contract_kind==='employment') {
    if(!d.job_title.trim())add(1,'job','Podaj stanowisko / rodzaj pracy.');
    const fraction=d.work_time_fraction.match(/^(\d+)\/(\d+)$/);
    if(!fraction||Number(fraction[1])<=0||Number(fraction[2])<=0||Number(fraction[1])>Number(fraction[2]))add(1,'fraction','Wpisz wymiar etatu jako ułamek, np. 1/1 lub 1/2.');
    if(d.work_time_fraction!=='1/1'&&!d.overtime_threshold.trim())add(1,'overtime','Dla niepełnego etatu ustal próg dodatku za godziny ponad umówiony wymiar.');
    if(f.contract_term==='fixed'&&d.term_basis!=='standard'&&!d.term_reason.trim())add(1,'reason','Opisz konkretną podstawę wyjątku dla umowy terminowej.');
  }
  if(f.contract_kind==='specific_work')for(const [key,label] of [['acceptance_criteria','kryteria rezultatu'],['acceptance_procedure','sposób odbioru'],['materials','materiały i współdziałanie']] as const)if(!d[key].trim())add(1,key,`Dzieło: uzupełnij ${label}.`);
  const s=f.net_cost_settings;
  if(!validQuestionDate(s.work_from)||!validQuestionDate(s.work_to)||s.work_to<s.work_from)add(1,'period','Podaj poprawny okres pracy dla pierwszej kalkulacji.');
  else if(s.work_from<f.start_date||f.end_date&&s.work_to>f.end_date)add(1,'period','Praca objęta kalkulacją musi mieścić się w okresie umowy.');
  if(!validQuestionDate(s.payment_date)||s.payment_date<s.work_to)add(1,'payment_date','Podaj datę wypłaty nie wcześniejszą od końca pracy objętej kalkulacją. Zaliczki wymagają łącznego rozliczenia.');
  if(!f.planned_net_amount||!Number.isFinite(Number(f.planned_net_amount))||Number(f.planned_net_amount)<=0)add(4,'net','Podaj dodatnią kwotę planowanego netto.');
  if(['hourly','piecework'].includes(s.basis)&&(!s.quantity||!Number.isFinite(Number(s.quantity))||Number(s.quantity)<=0))add(4,'quantity','Podaj planowaną liczbę godzin lub jednostek.');
  if(f.contract_kind==='specific_work'&&s.basis!=='fixed')add(4,'basis','Dla tego wzoru dzieła wybierz kwotę za całość / jedną wypłatę.');
  if(f.contract_kind==='employment'&&s.basis!=='monthly')add(4,'basis','Plan netto etatu podaj za miesiąc. W dokumencie trzeba zapisać wynagrodzenie brutto.');
  if(f.contract_kind==='mandate'&&f.settlement_cycle==='monthly'&&s.basis==='fixed')add(4,'basis','Przy rozliczeniu miesięcznym wybierz stawkę godzinową, miesięczną albo akord.');
  const assessment=assessQuestionnaire({kind:f.contract_kind,profile:profileFromQuestionnaire(f.payroll_profile),settings:s,partyKind:f.party_kind,currency:f.currency});
  return [...issues,...assessment.issues];
}
