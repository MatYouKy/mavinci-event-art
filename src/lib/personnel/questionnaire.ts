import type { PersonnelPayrollProfile } from './legal';
import type { NetCostSettings } from './netCostEstimate';

export type PersonnelQuestionnaire = { version: 1; answers: Record<string, string>; confirmed: boolean };
export type QuestionContext = { kind: string; profile: PersonnelPayrollProfile; settings: NetCostSettings; partyKind: string; currency: string };
export type Question = { key: string; step: number; label: string; help?: string; type?: 'date' | 'number' | 'text'; options?: [string, string][]; when?: (a: Record<string,string>, c: QuestionContext) => boolean };
export type WizardIssue = { step: number; message: string; key: string; review?: boolean };
export const wizardSteps = ['Strony umowy', 'Praca i okres', 'Sytuacja osoby', 'Podatki i oświadczenia', 'Wynagrodzenie', 'Podsumowanie'];
export const newQuestionnaire = (): PersonnelQuestionnaire => ({ version: 1, answers: {}, confirmed: false });
const yesNo: [string,string][] = [['no','Nie'],['yes','Tak'],['unknown','Nie wiem — do ustalenia']];
const person = (_: Record<string,string>, c: QuestionContext) => c.partyKind === 'person';
const civil = (a: Record<string,string>, c: QuestionContext) => person(a,c) && c.kind !== 'employment';
const mandate = (a: Record<string,string>, c: QuestionContext) => person(a,c) && c.kind === 'mandate';
export const validQuestionDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s;
export function birthday(born: string, age: number) {
  if (!validQuestionDate(born)) return '';
  const [y,m,d] = born.split('-').map(Number);
  return `${y+age}-${String(m).padStart(2,'0')}-${String(Math.min(d,new Date(Date.UTC(y+age,m,0)).getUTCDate())).padStart(2,'0')}`;
}
const young = (a: Record<string,string>, c: QuestionContext) => person(a,c) && c.kind !== 'specific_work' && validQuestionDate(a.birth_date) && validQuestionDate(c.settings.payment_date) && c.settings.payment_date <= birthday(a.birth_date,26);

const needsSocial = (a: Record<string,string>, c: QuestionContext) => {
  if(c.partyKind!=='person'||c.kind==='specific_work')return false;
  if(c.kind==='employment')return true;
  if(['pupil','student'].includes(a.education)&&validQuestionDate(a.birth_date)&&validQuestionDate(c.settings.work_to)&&c.settings.work_to<birthday(a.birth_date,26))return false;
  return !(a.other_employment==='one'&&a.employment_pay==='fixed'&&Number(a.employment_gross)>=4806&&a.employment_break==='no');
};
// Only visible questions are required. An explicit "unknown" is an answer, but never a tax assumption.
export const personnelQuestions: Question[] = [
  {key:'work_nature',step:1,label:'Na czym ma polegać współpraca?',options:[['services','Wykonywanie czynności / obsługa / usługi'],['result','Wykonanie konkretnego, indywidualnego dzieła'],['employment','Praca na etacie'],['unknown','Nie wiem — potrzebna ocena']]},
  {key:'supervision',step:1,label:'Czy osoba ma pracować pod kierownictwem firmy, w wyznaczonym przez nią miejscu i czasie?',help:'Np. przełożony na bieżąco zleca zadania i ustala obowiązkowy rozkład pracy. Sam termin wydarzenia nie rozstrzyga rodzaju umowy.',options:yesNo,when:civil},
  {key:'result_check',step:1,label:'Czy rezultat można opisać, odebrać i sprawdzić pod kątem wad?',help:'Sama liczba przepracowanych godzin, gotowość lub powtarzalna obsługa nie stanowią indywidualnego dzieła.',options:yesNo,when:(_,c)=>c.kind==='specific_work'},
  {key:'birth_date',step:2,label:'Data urodzenia osoby',type:'date',when:person},
  {key:'citizenship',step:2,label:'Czy osoba ma obywatelstwo polskie?',options:[['PL','Tak'],['other','Nie — potrzebne dokumenty pobytowe / uprawnienie do pracy'],['unknown','Nie wiem']],when:person},
  {key:'residency',step:2,label:'Gdzie osoba rozlicza się jako rezydent podatkowy?',help:'Obywatelstwo i adres zamieszkania same nie przesądzają rezydencji. Odpowiedź powinna wynikać z oświadczenia osoby.',options:[['PL','W Polsce — potwierdzone oświadczeniem'],['other','W innym kraju'],['unknown','Nie ustalono']],when:person},
  {key:'foreign_insurance',step:2,label:'Czy osoba pracuje za granicą, ma zagraniczne ubezpieczenie lub dokument A1?',options:yesNo,when:person},
  {key:'own_employer',step:2,label:'Czy osoba ma już umowę o pracę z działalnością wybraną w tej umowie?',help:'Dostęp do CRM nie oznacza zatrudnienia na etacie.',options:yesNo,when:civil},
  {key:'for_employer',step:2,label:'Czy wykonana praca będzie służyć jej obecnemu pracodawcy, nawet jeśli umowę podpisuje z Mavinci?',help:'Chodzi także o pracę na rzecz pracodawcy za pośrednictwem innej firmy.',options:yesNo,when:civil},
  {key:'education',step:2,label:'Jaki jest aktualny status nauki?',options:[['none','Nie jest uczniem ani studentem'],['pupil','Uczeń szkoły'],['student','Student studiów I / II stopnia lub jednolitych'],['other','Studia podyplomowe / doktoranckie — bez statusu studenta dla ZUS'],['unknown','Nie wiem']],when:mandate},
  {key:'education_from',step:2,label:'Status ucznia / studenta potwierdzony od',type:'date',when:(a,c)=>mandate(a,c)&&['pupil','student'].includes(a.education)},
  {key:'education_to',step:2,label:'Do kiedy potwierdzono ciągłość tego statusu?',help:'Uwzględnij obronę, skreślenie z listy oraz przerwę między studiami. Sama ważna legitymacja nie zawsze wystarcza.',type:'date',when:(a,c)=>mandate(a,c)&&['pupil','student'].includes(a.education)},
  {key:'education_proof',step:2,label:'Dokument potwierdzający status i jego ciągłość',help:'Np. zaświadczenie uczelni z datą, wskazanie pliku w aktach.',type:'text',when:(a,c)=>mandate(a,c)&&['pupil','student'].includes(a.education)},
  {key:'other_employment',step:2,label:'Czy w tym okresie osoba ma etat w innej firmie?',options:[['no','Nie'],['one','Tak, u jednego pracodawcy'],['multiple','Tak, u kilku pracodawców'],['unknown','Nie wiem']],when:person},
  {key:'employment_from',step:2,label:'Początek etatu w innej firmie',type:'date',when:a=>a.other_employment==='one'},
  {key:'employment_to',step:2,label:'Do kiedy potwierdzono trwanie etatu?',help:'Przy etacie bezterminowym podaj ostatni dzień okresu objętego oświadczeniem. Aktualizuj przy kolejnym rozliczeniu.',type:'date',when:a=>a.other_employment==='one'},
  {key:'employment_pay',step:2,label:'Czy w innym etacie zagwarantowano stałe miesięczne wynagrodzenie brutto?',options:[['fixed','Tak — znam kwotę z umowy / zaświadczenia'],['variable','Nie — kwota jest zmienna lub zależy od godzin'],['unknown','Nie wiem']],when:a=>a.other_employment==='one'},
  {key:'employment_gross',step:2,label:'Gwarantowane miesięczne brutto u innego pracodawcy',help:'Kwota za pełny miesiąc z dokumentu, nie przelew netto i nie kwota obniżona przez chorobę.',type:'number',when:a=>a.other_employment==='one'&&a.employment_pay==='fixed'},
  {key:'employment_break',step:2,label:'Czy występuje urlop bezpłatny, wychowawczy lub pobieranie zasiłku macierzyńskiego?',options:yesNo,when:a=>a.other_employment==='one'},
  {key:'other_mandates',step:2,label:'Czy osoba ma inne zlecenia lub umowy o świadczenie usług, także w Mavinci?',options:yesNo,when:person},
  {key:'business',step:2,label:'Czy prowadzi działalność gospodarczą lub jest wspólnikiem objętym ubezpieczeniami?',help:'Także działalność zawieszona, ulga na start, preferencyjny ZUS i współpraca przy działalności.',options:yesNo,when:person},
  {key:'pension',step:2,label:'Czy pobiera emeryturę, rentę lub inne świadczenie wpływające na ubezpieczenia?',options:yesNo,when:person},
  {key:'krus',step:2,label:'Czy jest ubezpieczona w KRUS?',help:'KRUS sam nie zwalnia ze składek zlecenia.',options:yesNo,when:person},
  {key:'krus_notified',step:2,label:'Czy zgłoszono umowę do KRUS i potwierdzono sytuację rolnika / domownika?',help:'Zachowanie KRUS zależy m.in. od miesięcznego przychodu ze wszystkich takich umów. Nie decyduj na podstawie samej kwoty netto.',options:yesNo,when:a=>a.krus==='yes'},
  {key:'other_status',step:2,label:'Czy są inne okoliczności: służba mundurowa, urlopy, ubezpieczenie duchownych lub szczególny tytuł?',options:yesNo,when:person},
  {key:'declaration_from',step:2,label:'Oświadczenie o sytuacji osoby obowiązuje od',type:'date',when:person},
  {key:'declaration_to',step:2,label:'Oświadczenie o sytuacji osoby obowiązuje do',help:'Wskaż potwierdzony okres. System sprawdzi go ponownie przy rozliczaniu kolejnego miesiąca.',type:'date',when:person},
  {key:'declaration_source',step:2,label:'Skąd pochodzą te informacje?',help:'Wpisz datę oświadczenia osoby i nazwę / numer dokumentu albo miejsce przechowywania w aktach.',type:'text',when:person},
  {key:'youth_opt_out',step:3,label:'Czy osoba złożyła wniosek, aby nie stosować ulgi dla młodych?',options:yesNo,when:young},
  {key:'youth_remaining',step:3,label:'Ile zostało ze wspólnego rocznego limitu 85 528 zł?',help:'Kwota z oświadczenia uwzględniająca innych płatników, wcześniejsze wypłaty i ulgi korzystające ze wspólnego limitu. Nie wpisuj automatycznie pełnego limitu.',type:'number',when:(a,c)=>young(a,c)&&a.youth_opt_out==='no'},
  {key:'pit2',step:3,label:'Jakie pomniejszenie zaliczki osoba wskazała w PIT-2 dla Mavinci?',options:[['0','Brak złożonego PIT-2 / brak pomniejszenia'],['100','100 zł miesięcznie'],['150','150 zł miesięcznie'],['300','300 zł miesięcznie'],['unknown','Nie wiem / nie mam oświadczenia']],when:person},
  {key:'pit2_elsewhere',step:3,label:'Łączne pomniejszenie zaliczki u pozostałych płatników w tym miesiącu',help:'Wszystkie miejsca pracy, zlecenia i organ rentowy łącznie. Suma wraz z Mavinci nie może przekroczyć 300 zł.',type:'number',when:a=>['100','150','300'].includes(a.pit2)},
  {key:'pit32',step:3,label:'Czy osoba złożyła wniosek o pobieranie zaliczek według stawki 32%?',options:yesNo,when:person},
  {key:'tax_reliefs',step:3,label:'Czy zgłoszono inne ulgi lub szczególne zasady PIT?',help:'Np. ulga na powrót, rodzina 4+, pracujący senior, wniosek o niepobieranie zaliczek albo zwolnienie na podstawie umowy międzynarodowej.',options:yesNo,when:person},
  {key:'copyright',step:3,label:'Czy umowa obejmuje przeniesienie praw autorskich, licencję wyłączną lub 50% kosztów uzyskania przychodu?',options:yesNo},
  {key:'ppk',step:3,label:'Jaki jest potwierdzony status PPK?',options:[['none','Nie naliczamy — udokumentowana rezygnacja lub brak obowiązku'],['yes','Naliczamy PPK'],['unknown','Nie ustalono']],when:person},
  {key:'deductions',step:3,label:'Czy są zajęcia komornicze, inne potrącenia, świadczenia rzeczowe lub dodatkowe składniki wypłaty?',options:yesNo,when:person},
  {key:'annual_limit',step:3,label:'Czy osiągnięto lub można osiągnąć w tej wypłacie roczny limit składek emerytalnych i rentowych?',help:'Uwzględnij podstawy u wszystkich płatników. Jeśli nie ma danych, wybierz „Nie wiem”.',options:yesNo,when:person},
  {key:'sex',step:3,label:'Płeć wskazana w dokumentach do ubezpieczeń',help:'Potrzebna do ustalenia wieku zwolnienia z FP i FGŚP: 55 lat dla kobiet, 60 lat dla mężczyzn.',options:[['female','Kobieta'],['male','Mężczyzna'],['unknown','Do ustalenia']],when:(a,c)=>person(a,c)&&validQuestionDate(a.birth_date)&&c.settings.work_to>=birthday(a.birth_date,55)},
  {key:'fund_exemption',step:3,label:'Czy osoba ma co najmniej 55 lat (kobieta) / 60 lat (mężczyzna) albo inne zwolnienie z funduszy pracowniczych?',help:'Np. powrót z urlopów związanych z rodzicielstwem, skierowanie z urzędu pracy. Szczególne zwolnienia wymagają ustalenia okresu.',options:yesNo,when:person},
  {key:'sickness',step:3,label:'Czy osoba wnosi o dobrowolne ubezpieczenie chorobowe ze zlecenia?',help:'Możliwe tylko przy obowiązkowych ubezpieczeniach emerytalnym i rentowych ze zlecenia. Przy samej zdrowotnej nie jest naliczane.',options:yesNo,when:(a,c)=>mandate(a,c)&&needsSocial(a,c)},
  {key:'additional_payment',step:3,label:'Czy w miesiącu planowanej wypłaty będzie inna wypłata lub zaliczka z tej umowy?',help:'Kilka przelewów w miesiącu wymaga łącznego rozliczenia limitów, PIT-2 i zaokrągleń.',options:yesNo,when:person},
  {key:'employment_payroll',step:3,label:'Czy rozliczenie etatu obejmuje niepełny miesiąc, absencje, nadgodziny, premie lub zmianę progu podatkowego?',options:yesNo,when:(_,c)=>c.kind==='employment'},
  {key:'employment_kup',step:3,label:'Jakie koszty pracownicze wynikają z oświadczenia?',options:[['250','Podstawowe — 250 zł'],['300','Podwyższone za dojazd — 300 zł, warunki potwierdzone'],['0','Nie stosować — 0 zł'],['unknown','Nie mam danych']],when:(_,c)=>c.kind==='employment'},
  {key:'term_history',step:3,label:'Czy sprawdzono wcześniejsze umowy terminowe i dopuszczalność obecnego okresu?',options:yesNo,when:(_,c)=>c.kind==='employment'},
  {key:'planned_hours',step:4,label:'Ile godzin pracy obejmuje ta wypłata?',help:'Także przy akordzie i kwocie za całość potrzebna jest ewidencja czasu do sprawdzenia minimalnego wynagrodzenia. Przy stawce godzinowej wpisz tę samą liczbę co w planie netto.',type:'number',when:mandate},
  {key:'voluntary_social',step:3,label:'Czy osoba chce przystąpić dobrowolnie do ubezpieczeń emerytalnego i rentowych ze zlecenia mimo etatu w innej firmie?',options:yesNo,when:(a,c)=>mandate(a,c)&&a.other_employment==='one'&&!needsSocial(a,c)},
  {key:'small_contract',step:4,label:'Czy należność określona w CAŁEJ umowie wynosi najwyżej 200 zł brutto?',help:'Nie chodzi o stawkę godzinową ani o pojedynczy przelew. Potwierdź kwotę całej umowy. Dla takiej umowy może obowiązywać ryczałt PIT zamiast zwykłej zaliczki.',options:yesNo,when:civil},
  {key:'employer_rates',step:4,label:'Czy stawkę wypadkową i obowiązek FGŚP potwierdzono dla wybranej działalności?',help:'To dane firmy. Znajdziesz je w ostatnim rozliczeniu od księgowości. Nie przyjmuj 1,67% tylko dlatego, że jest typowe.',options:yesNo,when:needsSocial},
  {key:'accident_rate',step:4,label:'Potwierdzona stawka wypadkowa (%)',type:'number',when:(a,c)=>needsSocial(a,c)&&a.employer_rates==='yes'},
  {key:'fgsp',step:4,label:'Czy firma ma naliczać FGŚP za tę osobę?',options:yesNo,when:(a,c)=>needsSocial(a,c)&&a.employer_rates==='yes'},
  {key:'fund_mode',step:4,label:'Jak ustalono Fundusz Pracy i Solidarnościowy dla tej wypłaty?',options:[['auto','Pełny miesiąc ubezpieczenia, bez innych podstaw i zwolnień — system sprawdzi próg'],['yes','Księgowość potwierdziła naliczanie FP/FS'],['no','Księgowość potwierdziła brak FP/FS'],['unknown','Brak ustalenia']],when:needsSocial},
  {key:'company_source',step:4,label:'Źródło potwierdzenia składek firmy',type:'text',help:'Np. rozliczenie od księgowej z datą i wskazaniem tej działalności.',when:needsSocial},
];
export const visibleQuestions = (a: Record<string,string>, c: QuestionContext) => personnelQuestions.filter(q=>!q.when || q.when(a,c));
export function assessQuestionnaire(c: QuestionContext) {
  const q = c.profile.questionnaire;
  const a = q?.answers || {};
  const issues: WizardIssue[] = [];
  const add = (key:string,message:string,review=true,step?:number) => issues.push({key,step:step ?? personnelQuestions.find(q=>q.key===key)?.step ?? 2,message,review});
  if (!q || q.version !== 1) add('declaration_source','Uzupełnij kreator i oświadczenie o sytuacji osoby.',false);
  for (const question of visibleQuestions(a,c)) {
    const v = a[question.key];
    if (!v?.trim()) { add(question.key,`Uzupełnij: ${question.label}`,false); continue; }
    if (v==='unknown') { add(question.key,`Do wyjaśnienia: ${question.label}`); continue; }
    if (question.options && !question.options.some(([key])=>key===v)) add(question.key,`Wybierz prawidłową odpowiedź: ${question.label}`,false);
    if (question.type==='date'&&!validQuestionDate(v)) add(question.key,`Popraw datę: ${question.label}`,false);
    if (question.type==='number'&&(!Number.isFinite(Number(v))||Number(v)<0)) add(question.key,`Podaj nieujemną kwotę: ${question.label}`,false);
  }
  const expected = c.kind==='employment'?'employment':c.kind==='specific_work'?'result':'services';
  if (a.work_nature && a.work_nature!=='unknown' && a.work_nature!==expected) add('work_nature','Opis współpracy nie odpowiada wybranemu rodzajowi umowy. Wróć do kroku 1 i popraw rodzaj.');
  if(c.kind!=='employment'&&a.supervision==='yes') add('supervision','Warunki mogą wskazywać na stosunek pracy. Ustal właściwy rodzaj umowy przed jej zawarciem.');
  if(c.kind==='specific_work'&&a.result_check==='no') add('result_check','Brak sprawdzalnego, indywidualnego rezultatu: wybierz zlecenie lub uzyskaj ocenę rodzaju umowy.');
  if(c.partyKind!=='person') add('work_nature','Rozliczenie firmy wymaga zasad B2B i dokumentu księgowego; kalkulator wynagrodzeń osoby nie ma zastosowania.');
  if(c.currency!=='PLN') add('company_source','Rozliczenie w walucie obcej wymaga przeliczeń i indywidualnego rozliczenia.');
  if(c.settings.payment_date?.slice(0,4)!=='2026') add('declaration_to','Automatyczny koszt jest dostępny dla wypłat w 2026 r. Inny rok wymaga aktualizacji reguł.');
  if(a.citizenship==='other') add('citizenship','Potwierdź z osobą prowadzącą kadry legalność pobytu i pracy oraz wymaganą formę umowy.');
  if(a.residency==='other') add('residency','Nierezydent: potrzebne ustalenie opodatkowania, certyfikatu rezydencji i właściwych dokumentów.');
  const exceptional: [string,string][] = [
    ['voluntary_social','Dobrowolne ubezpieczenia społeczne przy zbiegu tytułów wymagają indywidualnego zgłoszenia i rozliczenia.'],
    ['foreign_insurance','Praca lub ubezpieczenie zagraniczne: ustal właściwe ustawodawstwo i dokument A1.'],
    ['other_mandates','Inne zlecenia: potrzebne okresy, kolejność tytułów oraz miesięczne podstawy składek.'],
    ['business','Działalność gospodarcza / wspólnik: ustal tytuł, podstawę i ewentualne ulgi w ZUS.'],
    ['pension','Świadczenie emerytalne / rentowe: potwierdź rodzaj świadczenia, zbieg i zwolnienia z funduszy.'],
    ['other_status','Szczególny tytuł ubezpieczenia wymaga ustalenia z osobą prowadzącą rozliczenia.'],
    ['tax_reliefs','Inna ulga PIT wymaga indywidualnego ustalenia podstawy i pozostałego wspólnego limitu.'],
    ['copyright','Prawa autorskie / 50% KUP: ustal zakres praw, formę umowy i podatkowe warunki zastosowania kosztów.'],
    ['deductions','Potrącenia lub dodatkowe świadczenia: potrzebne pełne rozliczenie płacowe.'],
    ['annual_limit','Roczny limit składek: potrzebne podstawy u wszystkich płatników i podział tej wypłaty.'],
    ['fund_exemption','Zwolnienie z funduszy: potwierdź podstawę i daty obowiązywania z księgowością.'],
    ['additional_payment','Kilka wypłat w miesiącu: rozlicz je łącznie na jednym rachunku / liście płac.'],
    ['employment_payroll','Nietypowy miesiąc etatu wymaga listy płac uwzględniającej wszystkie składniki.'],
  ];
  for(const [key,message] of exceptional) if(a[key]==='yes'&&visibleQuestions(a,c).some(q=>q.key===key)) add(key,message);
  if(c.kind!=='employment'&&(a.own_employer==='yes'||a.for_employer==='yes')) add('own_employer','Dodatkowa umowa z własnym pracodawcą / na jego rzecz wymaga łącznego rozliczenia z etatem.');
  if(a.ppk==='yes') add('ppk','PPK wymaga uwzględnienia składek osoby i firmy oraz przychodu z wpłaty pracodawcy w rozliczeniu płacowym.');
  if(a.other_employment==='multiple') add('other_employment','Kilka etatów: potrzebne łączne podstawy i okresy zatrudnienia.');
  if(a.other_employment==='one') {
    if(a.employment_pay==='variable') add('employment_pay','Zmienne wynagrodzenie z etatu wymaga ustalenia podstawy składek za ten miesiąc.');
    if(a.employment_break==='yes') add('employment_break','Urlop lub zasiłek może zmienić tytuł ubezpieczenia. Ustal dokładne daty i podstawy.');
    if(a.employment_pay==='fixed'&&Number(a.employment_gross)<=0) add('employment_gross','Podaj dodatnią kwotę gwarantowanego brutto.',false);
  }
  if(a.krus==='yes'&&a.krus_notified!=='yes') add('krus_notified','Potwierdź zgłoszenie do KRUS i warunki dalszego ubezpieczenia; KRUS nie zastępuje składek ZUS zlecenia.');
  if(c.kind==='employment'&&a.term_history==='no') add('term_history','Sprawdź wcześniejsze umowy i dopuszczalność okresu zatrudnienia.');
  const from=c.settings.work_from,to=c.settings.work_to;
  if(validQuestionDate(from)&&from.slice(0,4)!=='2026')add('declaration_to','Ten okres pracy wymaga reguł dla innego roku. Kalkulator obsługuje pracę i wypłatę w 2026 r.',true,1);
  if(validQuestionDate(a.birth_date)&&validQuestionDate(to)&&((a.sex==='female'&&to>=birthday(a.birth_date,55))||to>=birthday(a.birth_date,60)))add('fund_exemption','Wiek wskazuje na zwolnienie z funduszy. Potwierdź z księgowością jego początek i zasady tego okresu.');
  if(!validQuestionDate(from)||!validQuestionDate(to)||to<from) add('declaration_to','Podaj poprawny okres pracy objęty kalkulacją w kroku 2.',false,1);
  for(const [start,end,key,label] of [[a.declaration_from,a.declaration_to,'declaration_to','Oświadczenie osoby'],...(a.other_employment==='one'?[[a.employment_from,a.employment_to,'employment_to','Potwierdzony etat']]:[])]) {
    if(validQuestionDate(start)&&validQuestionDate(end)&&(end<start||start>from||end<to)) add(key,`${label} musi obejmować cały okres pracy z kroku 2. Uzupełnij daty albo podziel rozliczenie.`);
  }
  if(validQuestionDate(a.birth_date)&&validQuestionDate(from)&&from<birthday(a.birth_date,18)) add('birth_date','Osoba niepełnoletnia: ustal dodatkowe warunki zawarcia umowy i dopuszczenia do pracy.');
  if(validQuestionDate(a.birth_date)&&a.birth_date>from) add('birth_date','Data urodzenia jest późniejsza niż data pracy.',false);
  let student=false;
  if(c.kind==='mandate'&&['pupil','student'].includes(a.education)&&validQuestionDate(a.birth_date)) {
    const turns26=birthday(a.birth_date,26);
    if(from<turns26&&to>=turns26) add('birth_date','Okres obejmuje 26. urodziny — podziel go według zmiany ubezpieczenia.');
    if(to<turns26) {
      student=validQuestionDate(a.education_from)&&validQuestionDate(a.education_to)&&a.education_from<=from&&a.education_to>=to;
      if(!student) add('education_to','Potwierdź status ucznia / studenta przez cały okres albo podziel rozliczenie według zmiany statusu.');
    }
  }
  const healthOnly=c.kind==='mandate'&&!student&&a.other_employment==='one'&&a.employment_pay==='fixed'&&Number(a.employment_gross)>=4806&&a.employment_break==='no';
  const insurance: NetCostSettings['insurance']=student?'auto':healthOnly?'health_only':'social_health';
  if(a.pit2&&a.pit2!=='unknown'&&Number(a.pit2)>0&&Number(a.pit2)+Number(a.pit2_elsewhere)>300) add('pit2_elsewhere','Łączne pomniejszenie PIT-2 przekracza 300 zł. Poproś osobę o poprawione oświadczenie.');
  if(young(a,c)&&a.youth_opt_out==='no'&&Number(a.youth_remaining)>85528) add('youth_remaining','Pozostały limit nie może przekraczać 85 528 zł.',false);
  if(c.kind==='mandate'&&Number(a.planned_hours)<=0)add('planned_hours','Podaj dodatnią liczbę godzin objętych wypłatą.',false);
  if(c.kind==='mandate'&&c.settings.basis==='hourly'&&a.planned_hours&&c.settings.quantity&&Number(a.planned_hours)!==Number(c.settings.quantity))add('planned_hours','Liczba godzin do minimum i liczba godzin w planie netto muszą być takie same.',false);
  const social=c.kind==='employment'||(c.kind==='mandate'&&!student&&!healthOnly);
  if(social) {
    if(a.employer_rates==='no') add('employer_rates','Uzyskaj stawkę wypadkową i zasady FGŚP wybranej firmy przed wyliczeniem kosztu.');
    if(a.employer_rates==='yes'&&(Number(a.accident_rate)<0.67||Number(a.accident_rate)>3.33)) add('accident_rate','Stawka wypadkowa w tym modelu musi mieścić się w zakresie 0,67–3,33%.',false);
    if(a.fund_mode==='auto'&&(from?.slice(-2)!=='01'||!validQuestionDate(to)||new Date(to+'T12:00:00Z').getUTCDate()!==new Date(Date.UTC(Number(to.slice(0,4)),Number(to.slice(5,7)),0)).getUTCDate()||a.other_employment!=='no')) add('fund_mode','Automatyczny próg FP/FS wymaga pełnego miesiąca ubezpieczenia i braku innych podstaw. Uzyskaj ustalenie księgowości dla tego okresu.');
  }
  if(from?.slice(0,7)!==to?.slice(0,7)) add('declaration_to','Kalkulacja obejmuje jeden miesiąc pracy. Dłuższą umowę rozliczaj miesiącami.',false,1);
  return {issues,student,healthOnly,social,insurance,label:c.kind==='specific_work'?'Dzieło poza własnym pracodawcą — bez ZUS':student?'Uczeń / student przed 26. urodzinami — bez ZUS':healthOnly?'Etat w innej firmie zapewnia minimum — tylko zdrowotna':'Składki społeczne i zdrowotna',
    settings:{insurance,sickness:social&&c.kind==='mandate'&&a.sickness==='yes',pit_credit:(['0','100','150','300'].includes(a.pit2)?a.pit2:'0') as NetCostSettings['pit_credit'],pit_rate:(a.pit32==='yes'?'32':'12') as NetCostSettings['pit_rate'],youth_remaining:a.youth_remaining||'',employment_kup:(['0','250','300'].includes(a.employment_kup)?a.employment_kup:'250') as NetCostSettings['employment_kup'],small_contract:c.kind!=='employment'&&a.small_contract==='yes',accident_rate:a.accident_rate||'1.67',fgsp:social&&a.fgsp==='yes',labour_fund:(['auto','yes','no'].includes(a.fund_mode)?a.fund_mode:'auto') as NetCostSettings['labour_fund']}};
}

export function profileFromQuestionnaire(profile: PersonnelPayrollProfile): PersonnelPayrollProfile {
  const a=profile.questionnaire?.answers;
  if(!a)return profile;
  return {...profile,birth_date:a.birth_date||'',education:a.education==='other'?'none':a.education||'unknown',education_from:a.education_from||'',education_to:a.education_to||'',tax_residency:a.residency||'unknown',own_employer:[a.own_employer,a.for_employer].includes('yes')?'yes':a.own_employer==='no'&&a.for_employer==='no'?'no':'unknown',youth_opt_out:a.youth_opt_out||'unknown'};
}
