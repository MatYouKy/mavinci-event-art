BEGIN;
ALTER TABLE public.personnel_contracts ADD COLUMN document_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(document_details)='object');
COMMENT ON COLUMN public.personnel_contracts.document_details IS 'Warunki wymagane w dokumencie umowy; po utrwaleniu dokumentu podlegają ochronie treści umowy.';

CREATE OR REPLACE FUNCTION public.generate_personnel_document(p_contract uuid,p_template uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 c public.personnel_contracts; t public.personnel_contract_templates; company public.my_companies;
 body text; vals jsonb; k text; v text; rates jsonb; result uuid; ver integer; pay_text text; required_tokens text[];
 d jsonb; company_address text; period_text text; scope_text text; payment_text text; payroll_text text;
 term_text text; fraction text; numerator numeric; denominator numeric; rate_count integer; coverage datemultirange;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do generowania umów'; END IF;
 SELECT * INTO c FROM public.personnel_contracts WHERE id=p_contract FOR UPDATE;
 SELECT * INTO t FROM public.personnel_contract_templates WHERE id=p_template AND is_active FOR SHARE;
 SELECT * INTO company FROM public.my_companies WHERE id=c.my_company_id;
 IF c.id IS NULL OR t.id IS NULL OR t.contract_kind<>c.contract_kind OR company.id IS NULL THEN RAISE EXCEPTION 'Wybierz działalność i szablon zgodny z rodzajem umowy'; END IF;
 IF c.signed_date IS NULL OR c.start_date IS NULL OR c.contract_term IS NULL OR c.contract_term NOT IN ('fixed','indefinite') OR (c.contract_term='fixed' AND c.end_date IS NULL) THEN RAISE EXCEPTION 'Uzupełnij datę zawarcia oraz okres umowy'; END IF;
 IF nullif(btrim(c.party_name),'') IS NULL OR nullif(btrim(c.party_address),'') IS NULL OR nullif(btrim(c.work_scope),'') IS NULL OR nullif(btrim(c.payment_terms),'') IS NULL OR nullif(btrim(c.issuer_representative),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij strony, adres, reprezentację, przedmiot umowy i warunki płatności'; END IF;
 IF nullif(btrim(company.legal_name),'') IS NULL OR nullif(btrim(company.nip),'') IS NULL OR nullif(btrim(company.street),'') IS NULL OR nullif(btrim(company.building_number),'') IS NULL OR nullif(btrim(company.postal_code),'') IS NULL OR nullif(btrim(company.city),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij pełną nazwę, NIP i adres wybranej działalności'; END IF;
 IF c.party_kind IS NULL THEN RAISE EXCEPTION 'Wskaż, czy stroną umowy jest osoba czy firma'; END IF;
 IF c.contract_kind IN ('mandate','employment') AND c.party_kind IS DISTINCT FROM 'person' THEN RAISE EXCEPTION 'Wskaż osobę będącą stroną umowy'; END IF;
 IF c.payment_method='bank' AND nullif(btrim(c.party_bank_account),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij rachunek do wypłaty'; END IF;
 d:=c.document_details;
 IF nullif(btrim(d->>'work_place'),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij miejsce wykonywania pracy lub przekazania dzieła'; END IF;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY valid_from),count(*),range_agg(daterange(valid_from,valid_to,'[]')),string_agg(
 to_char(valid_from,'DD.MM.YYYY')||' - '||coalesce(to_char(valid_to,'DD.MM.YYYY'),'bezterminowo')||': '||replace(rate::text,'.',',')||' '||c.currency||CASE rate_basis WHEN 'gross' THEN ' brutto' ELSE ' netto' END||CASE pay_basis WHEN 'hourly' THEN ' / godz.' WHEN 'monthly' THEN ' / miesiąc' WHEN 'piecework' THEN ' / '||unit_label ELSE ' za całość' END,E'\n' ORDER BY valid_from)
 INTO rates,rate_count,coverage,pay_text FROM public.personnel_contract_rates r WHERE contract_id=c.id;
 IF rates IS NULL THEN RAISE EXCEPTION 'Dodaj i zapisz warunki wynagrodzenia'; END IF;
 IF NOT (coverage @> daterange(c.start_date,c.end_date,'[]')) THEN RAISE EXCEPTION 'Zapisane stawki muszą obejmować cały okres umowy bez przerw'; END IF;
 term_text:='';
 IF c.contract_kind='employment' THEN
  IF c.agreement_form<>'written' THEN RAISE EXCEPTION 'Umowa o pracę wymaga formy pisemnej'; END IF;
  IF nullif(btrim(d->>'job_title'),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij stanowisko lub rodzaj pracy'; END IF;
  fraction:=btrim(coalesce(d->>'work_time_fraction',''));
  IF fraction !~ '^[1-9][0-9]{0,2}/[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'Podaj wymiar etatu jako ułamek, np. 1/1 lub 1/2'; END IF;
  numerator:=split_part(fraction,'/',1)::numeric;denominator:=split_part(fraction,'/',2)::numeric;
  IF numerator>denominator THEN RAISE EXCEPTION 'Wymiar etatu nie może przekraczać 1/1'; END IF;
  IF numerator<denominator AND nullif(btrim(d->>'overtime_threshold'),'') IS NULL THEN RAISE EXCEPTION 'Dla niepełnego etatu ustal próg godzin uprawniający do dodatku z art. 151 § 5'; END IF;
  IF EXISTS(SELECT 1 FROM public.personnel_contract_rates WHERE contract_id=c.id AND (rate_basis<>'gross' OR pay_basis NOT IN ('hourly','monthly','piecework'))) THEN RAISE EXCEPTION 'W dokumencie umowy o pracę zapisz wynagrodzenie brutto: miesięczne, godzinowe lub akordowe'; END IF;
  IF c.contract_term='fixed' THEN
   IF coalesce(d->>'term_basis','standard') NOT IN ('standard','replacement','seasonal','tenure','objective') THEN RAISE EXCEPTION 'Wybierz podstawę umowy na czas określony'; END IF;
   IF coalesce(d->>'term_basis','standard')='standard' THEN
    IF c.end_date>=(c.start_date+interval '33 months')::date THEN RAISE EXCEPTION 'Ta umowa przekracza 33 miesiące. Zweryfikuj podstawę umowy terminowej'; END IF;
    term_text:='Umowa terminowa podlega ograniczeniom wynikającym z art. 25¹ Kodeksu pracy, z uwzględnieniem wcześniejszego zatrudnienia między stronami.';
   ELSE
    IF nullif(btrim(d->>'term_reason'),'') IS NULL THEN RAISE EXCEPTION 'Opisz konkretny cel lub obiektywne przyczyny zawarcia umowy terminowej'; END IF;
    term_text:='Podstawa zawarcia umowy terminowej: '||CASE d->>'term_basis' WHEN 'replacement' THEN 'zastępstwo' WHEN 'seasonal' THEN 'praca dorywcza lub sezonowa' WHEN 'tenure' THEN 'okres kadencji' ELSE 'obiektywne przyczyny po stronie pracodawcy' END||'. Cel i okoliczności: '||(d->>'term_reason')||'. Wyłączenie limitów wymaga spełnienia przesłanek art. 25¹ § 4 Kodeksu pracy.';
    IF d->>'term_basis'='objective' THEN term_text:=term_text||' Pracodawca zawiadamia właściwego okręgowego inspektora pracy w terminie 5 dni roboczych od zawarcia umowy.'; END IF;
   END IF;
  END IF;
 ELSIF c.contract_kind='specific_work' THEN
  IF c.contract_term<>'fixed' OR c.end_date IS NULL THEN RAISE EXCEPTION 'Dzieło wymaga określonego terminu ukończenia'; END IF;
  IF rate_count<>1 OR EXISTS(SELECT 1 FROM public.personnel_contract_rates WHERE contract_id=c.id AND pay_basis<>'fixed') THEN RAISE EXCEPTION 'Ten wzór dzieła wymaga jednej kwoty za całość. Zapisz taką stawkę w warunkach wynagrodzenia'; END IF;
  IF nullif(btrim(d->>'acceptance_criteria'),'') IS NULL OR nullif(btrim(d->>'acceptance_procedure'),'') IS NULL OR nullif(btrim(d->>'materials'),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij kryteria rezultatu, sposób odbioru oraz zasady materiałów i narzędzi'; END IF;
 END IF;
 company_address:=concat_ws(', ',concat_ws(' ',company.street,company.building_number||CASE WHEN nullif(btrim(company.apartment_number),'') IS NOT NULL THEN '/'||company.apartment_number ELSE '' END),company.postal_code||' '||company.city);
 period_text:=CASE WHEN c.contract_term='indefinite' THEN 'Umowa zostaje zawarta na czas nieokreślony od '||to_char(c.start_date,'DD.MM.YYYY')||'.' ELSE 'Umowa zostaje zawarta na okres od '||to_char(c.start_date,'DD.MM.YYYY')||' do '||to_char(c.end_date,'DD.MM.YYYY')||' (włącznie).' END;
 scope_text:=CASE WHEN c.engagement_scope='event' THEN 'jedna realizacja: '||coalesce((SELECT name FROM public.events WHERE id=c.event_id),'niewskazana realizacja') ELSE 'współpraca w uzgodnionym okresie, obejmująca czynności opisane w umowie' END;
 payment_text:=CASE WHEN c.payment_method='cash' THEN CASE WHEN c.contract_kind='employment' THEN 'Wypłata do rąk własnych na wniosek Pracownika, za potwierdzeniem odbioru.' ELSE 'Wypłata gotówką, za potwierdzeniem odbioru.' END ELSE 'Rachunek do wypłaty: '||c.party_bank_account||'.' END;
 payroll_text:=CASE WHEN c.party_kind='company' THEN 'Rozliczenie następuje na podstawie prawidłowego dokumentu księgowego według statusu podatkowego stron. Strony wykonują obowiązki podatkowe wynikające z przepisów.' ELSE 'Zleceniodawca / Pracodawca / Zamawiający wykonuje obowiązki płatnika PIT i składek w zakresie wynikającym z przepisów i aktualnych oświadczeń osoby. Zwolnienie podatkowe nie jest automatycznie zwolnieniem ze składek. Forma gotówkowa nie zmienia obowiązków publicznoprawnych.' END;
 IF c.party_kind='person' AND c.contract_kind<>'specific_work' THEN
  payroll_text:=payroll_text||' Ulgę dla młodych stosuje się wyłącznie do przychodów objętych ulgą, we właściwym wieku i do dostępnego wspólnego limitu rocznego, o ile nie złożono wniosku o niestosowanie.';
  IF c.payroll_profile->>'youth_opt_out'='yes' THEN payroll_text:=payroll_text||' Według danych przekazanych do rozliczenia złożono wniosek o niestosowanie ulgi dla młodych.'; END IF;
 END IF;
 IF c.party_kind='person' AND c.contract_kind='mandate' AND c.payroll_profile->>'education' IN ('student','pupil') THEN
  payroll_text:=payroll_text||' Wskazano status: '||CASE c.payroll_profile->>'education' WHEN 'student' THEN 'student' ELSE 'uczeń' END||'. Zwolnienie z ZUS wymaga potwierdzenia statusu i wieku w okresie pracy oraz spełnienia pozostałych przesłanek; nie dotyczy pracy dla własnego pracodawcy lub na jego rzecz.';
 END IF;
 vals:=jsonb_build_object(
 'numer',c.contract_number,'data_zawarcia',to_char(c.signed_date,'DD.MM.YYYY'),'zleceniodawca',company.legal_name,'adres_zleceniodawcy',company_address,'nip_zleceniodawcy',company.nip,'reprezentacja',c.issuer_representative,'osoba',c.party_name,'adres_osoby',c.party_address,'identyfikator',coalesce(nullif(c.party_identifier,''),'nie podano'),
 'zakres',c.work_scope,'od',to_char(c.start_date,'DD.MM.YYYY'),'do',coalesce(to_char(c.end_date,'DD.MM.YYYY'),'bezterminowo'),'wynagrodzenie',pay_text,'warunki_platnosci',c.payment_terms,'rachunek',payment_text,'ustalenia',coalesce(nullif(btrim(c.additional_terms),''),'Brak dodatkowych ustaleń.'),
 'miejsce',d->>'work_place','typ_okresu',CASE c.contract_term WHEN 'fixed' THEN 'na czas określony' ELSE 'na czas nieokreślony' END,'okres_umowy',period_text,'realizacja',scope_text,'forma_ustalen',CASE WHEN c.agreement_form='oral' THEN 'Niniejszy dokument potwierdza zawarte przez strony ustne ustalenia.' ELSE 'Strony utrwalają uzgodnienia w formie pisemnej.' END,
 'sposob_wyplaty',CASE c.payment_method WHEN 'cash' THEN 'gotówka za potwierdzeniem odbioru' ELSE 'przelew' END,'rozliczenie',CASE c.settlement_cycle WHEN 'monthly' THEN 'miesięczne' ELSE 'po zakończeniu realizacji' END,
 'ewidencja_godzin',coalesce(nullif(btrim(d->>'time_evidence'),''),'Zleceniobiorca zapisuje rzeczywiste godziny w CRM albo przekazuje pisemne lub elektroniczne zestawienie, do 3. dnia następnego miesiąca, a przy krótszej umowie po jej zakończeniu. Zleceniodawca potwierdza dane lub zgłasza konkretne rozbieżności. Ewidencję przechowuje się przez okres wymagany przepisami.'),
 'podatki_skladki',payroll_text,'stanowisko',d->>'job_title','wymiar_etatu',d->>'work_time_fraction','limit_ponadwymiarowy',CASE WHEN numerator<denominator THEN 'Dopuszczalna liczba godzin ponad umówiony wymiar, po przekroczeniu której przysługuje dodatek z art. 151 § 5 Kodeksu pracy: '||(d->>'overtime_threshold')||'.' ELSE 'Ustalono pełny wymiar czasu pracy.' END,
 'pozostale_skladniki',coalesce(nullif(btrim(d->>'additional_pay'),''),'Poza wynagrodzeniem zasadniczym przysługują świadczenia wynikające z obowiązujących przepisów i właściwych przepisów wewnątrzzakładowych.'),'podstawa_terminowa',term_text,
 'kryteria_odbioru',d->>'acceptance_criteria','odbior',d->>'acceptance_procedure','materialy',d->>'materials');
 required_tokens:=ARRAY['numer','data_zawarcia','zleceniodawca','adres_zleceniodawcy','reprezentacja','osoba','adres_osoby','zakres','wynagrodzenie','warunki_platnosci','rachunek','miejsce','podatki_skladki'];
 IF c.contract_kind='employment' THEN required_tokens:=required_tokens||ARRAY['typ_okresu','okres_umowy','stanowisko','wymiar_etatu','limit_ponadwymiarowy','pozostale_skladniki','podstawa_terminowa'];
 ELSIF c.contract_kind='specific_work' THEN required_tokens:=required_tokens||ARRAY['od','do','kryteria_odbioru','odbior','materialy','forma_ustalen','rozliczenie'];
 ELSE required_tokens:=required_tokens||ARRAY['okres_umowy','ewidencja_godzin','rozliczenie','forma_ustalen']; END IF;
 FOREACH k IN ARRAY required_tokens LOOP IF strpos(t.content,'{{'||k||'}}')=0 THEN RAISE EXCEPTION 'Szablon nie zawiera wymaganego pola: %. Uzupełnij szablon albo wybierz standard 2026.',k; END IF; END LOOP;
 FOR k IN SELECT parts[1] FROM regexp_matches(t.content,'\{\{([^}]+)\}\}','g') AS tok(parts) LOOP
  IF NOT (vals ? k) THEN RAISE EXCEPTION 'Nieznany placeholder: %',k; END IF;
  IF vals->>k IS NULL THEN RAISE EXCEPTION 'Nie uzupełniono pola wymaganego przez szablon: %',k; END IF;
 END LOOP;
 body:=CASE WHEN c.agreement_form='oral' THEN E'POTWIERDZENIE USTALEŃ USTNYCH\n\n' ELSE '' END||t.content;
 FOR k,v IN SELECT * FROM jsonb_each_text(vals) LOOP body:=replace(body,'{{'||k||'}}',coalesce(v,'')); END LOOP;
 IF body~'\{\{[^}]+\}\}' THEN RAISE EXCEPTION 'Dokument zawiera nierozwiązane placeholdery'; END IF;
 SELECT coalesce(max(version),0)+1 INTO ver FROM public.personnel_contract_documents WHERE contract_id=c.id;
 INSERT INTO public.personnel_contract_documents(contract_id,version,content,snapshot,created_by) VALUES(c.id,ver,body,jsonb_build_object('contract',to_jsonb(c),'company',to_jsonb(company),'template',to_jsonb(t),'rates',rates,'document_rules_version','PL-2026-09-21','pdf_layout_version',1),public.current_workflow_employee_id()) RETURNING id INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.generate_personnel_document(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_personnel_document(uuid,uuid) TO authenticated;

UPDATE public.personnel_contract_templates SET is_active=false WHERE name='Umowa zlecenie — podstawowy' AND version=1 AND content=E'UMOWA ZLECENIE NR {{numer}}\n\nZawarta dnia {{data_zawarcia}} pomiędzy:\n{{zleceniodawca}}\n{{adres_zleceniodawcy}}, NIP: {{nip_zleceniodawcy}}\nReprezentacja: {{reprezentacja}}\na\n{{osoba}}, {{adres_osoby}}\nIdentyfikator: {{identyfikator}}\n\n§ 1. Przedmiot zlecenia\n{{zakres}}\n\n§ 2. Okres wykonania\nOd {{od}} do {{do}}.\n\n§ 3. Wynagrodzenie i rozliczenie\n{{wynagrodzenie}}\n{{warunki_platnosci}}\nRachunek do wypłaty: {{rachunek}}\n\n§ 4. Dodatkowe ustalenia\n{{ustalenia}}\n\nZleceniodawca: ____________________\nZleceniobiorca: ____________________';

INSERT INTO public.personnel_contract_templates(name,contract_kind,content) VALUES ('Umowa o pracę — standard 2026','employment',$template$UMOWA O PRACĘ NR {{numer}}

Zawarta dnia {{data_zawarcia}} pomiędzy:
{{zleceniodawca}}, z siedzibą: {{adres_zleceniodawcy}}, NIP {{nip_zleceniodawcy}}, reprezentowaną przez: {{reprezentacja}},
a
{{osoba}}, adres: {{adres_osoby}}, identyfikator: {{identyfikator}}.

Pierwsza ze stron jest dalej nazywana Pracodawcą, druga Pracownikiem.

§ 1. Rodzaj umowy i rozpoczęcie pracy
Strony zawierają umowę o pracę {{typ_okresu}}.
{{okres_umowy}}
Dzień rozpoczęcia pracy: {{od}}.
{{podstawa_terminowa}}

§ 2. Rodzaj, miejsce i wymiar pracy
Stanowisko / rodzaj pracy: {{stanowisko}}.
Zakres umówionej pracy:
{{zakres}}
Miejsce lub miejsca wykonywania pracy: {{miejsce}}.
Wymiar czasu pracy: {{wymiar_etatu}} etatu.
{{limit_ponadwymiarowy}}

Pracownik wykonuje umówioną pracę na rzecz i pod kierownictwem Pracodawcy, w uzgodnionym miejscu i czasie wynikającym z obowiązującego rozkładu czasu pracy. Zakres współpracy wskazany w formularzu: {{realizacja}}. Powiązanie z realizacją nie ogranicza praw pracowniczych ani nie zmienia uzgodnionego rodzaju umowy.

§ 3. Wynagrodzenie
Wynagrodzenie zasadnicze, z podaniem okresu i sposobu naliczania:
{{wynagrodzenie}}
Pozostałe składniki i świadczenia:
{{pozostale_skladniki}}

Wynagrodzenie oraz jego składniki ustalane są w kwotach brutto. Pracodawca dokonuje potrąceń wynikających z przepisów. Wynagrodzenie uwzględniane przy ustalaniu ustawowego minimum nie może być niższe od kwoty obowiązującej dla danego okresu i wymiaru etatu; w razie potrzeby Pracodawca wypłaca wyrównanie.

§ 4. Termin i sposób wypłaty
Wynagrodzenie jest wypłacane co najmniej raz w miesiącu, w stałym, ustalonym terminie: {{warunki_platnosci}}
Termin wypłaty wynagrodzenia płatnego z dołu nie może przypadać później niż w ciągu pierwszych 10 dni następnego miesiąca. Jeżeli dzień wypłaty jest dniem wolnym od pracy, wypłata następuje w dniu poprzedzającym.
Sposób wypłaty: {{sposob_wyplaty}}.
{{rachunek}}
{{podatki_skladki}}

§ 5. Organizacja i warunki zatrudnienia
Pracodawca przed dopuszczeniem do pracy zapewnia wymagane badania profilaktyczne i szkolenie BHP, z uwzględnieniem ustawowych wyjątków, oraz informuje o ryzyku zawodowym. Pracownik przestrzega przepisów i zasad BHP oraz obowiązującej organizacji pracy.

Pracodawca przekazuje Pracownikowi odrębną informację o warunkach zatrudnienia wymaganą art. 29 § 3 Kodeksu pracy w ustawowych terminach. Niniejsza umowa nie zastępuje tej informacji. Urlop, odpoczynek, czas pracy i inne uprawnienia pracownicze ustala się zgodnie z prawem pracy.

§ 6. Zmiana i rozwiązanie umowy
Zmiana warunków umowy wymaga formy pisemnej. Rozwiązanie umowy, forma oświadczeń, okresy wypowiedzenia i obowiązek podania przyczyny następują zgodnie z Kodeksem pracy, z uwzględnieniem rodzaju umowy i okresu zatrudnienia.

§ 7. Postanowienia końcowe
Dodatkowe ustalenia: {{ustalenia}}
Postanowienia umowy nie mogą być mniej korzystne dla Pracownika niż przepisy prawa pracy. W zakresie nieuregulowanym stosuje się Kodeks pracy i pozostałe właściwe przepisy. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej strony.

Pracodawca: __________________________
Pracownik: __________________________$template$);

INSERT INTO public.personnel_contract_templates(name,contract_kind,content) VALUES ('Umowa o dzieło — standard 2026','specific_work',$template$UMOWA O DZIEŁO NR {{numer}}

Zawarta dnia {{data_zawarcia}} pomiędzy:
{{zleceniodawca}}, z siedzibą: {{adres_zleceniodawcy}}, NIP {{nip_zleceniodawcy}}, reprezentowaną przez: {{reprezentacja}},
a
{{osoba}}, adres: {{adres_osoby}}, identyfikator: {{identyfikator}}.

Pierwsza ze stron jest dalej nazywana Zamawiającym, druga Wykonawcą. {{forma_ustalen}}

§ 1. Dzieło
Zamawiający zamawia, a Wykonawca zobowiązuje się wykonać następujący, indywidualnie określony rezultat:
{{zakres}}
Cechy, parametry i kryteria sprawdzenia zgodności dzieła:
{{kryteria_odbioru}}
Miejsce wykonania lub przekazania: {{miejsce}}.
Powiązanie z realizacją: {{realizacja}}.

Przedmiotem umowy jest osiągnięcie określonego, możliwego do odebrania rezultatu. Samo wykonywanie powtarzalnych czynności lub pozostawanie w gotowości nie stanowi wykonania dzieła objętego tą umową.

§ 2. Termin i materiały
Rozpoczęcie wykonania: {{od}}. Dzieło zostanie ukończone i przedstawione do odbioru najpóźniej dnia {{do}}.
Materiały, narzędzia i współdziałanie stron:
{{materialy}}
Wykonawca informuje Zamawiającego o okolicznościach mogących przeszkodzić prawidłowemu wykonaniu dzieła, w szczególności o nieprzydatności dostarczonych materiałów lub wskazówek. Materiały Zamawiającego wykorzystuje zgodnie z przeznaczeniem i rozlicza ich zużycie.

§ 3. Przekazanie i odbiór
{{odbior}}
Zamawiający odbiera dzieło przedstawione zgodnie z umową. W razie stwierdzenia wad strony opisują je w protokole lub innym uzgodnionym dokumencie i stosują uprawnienia wynikające z Kodeksu cywilnego. Sam brak odpowiedzi Zamawiającego nie jest umownym potwierdzeniem odbioru bez zastrzeżeń.

§ 4. Wynagrodzenie
Za wykonanie dzieła strony ustalają:
{{wynagrodzenie}}
Cykl rozliczeń: {{rozliczenie}}. Wypłaty przed oddaniem dzieła stanowią zaliczki na poczet uzgodnionego wynagrodzenia, rozliczane przy jego oddaniu.
Warunki i termin płatności: {{warunki_platnosci}}
Sposób wypłaty: {{sposob_wyplaty}}.
{{rachunek}}

Wskazana kwota dotyczy całego dzieła. Oznaczenie „netto” określa kwotę należną Wykonawcy po obowiązkowych potrąceniach; odpowiadające jej brutto ustala się dla wypłaty według przepisów i aktualnych danych Wykonawcy. W razie braku odmiennych ustaleń wynagrodzenie jest należne w chwili oddania dzieła.
{{podatki_skladki}}

§ 5. Odpowiedzialność i zakończenie umowy
Do opóźnienia, wykonywania dzieła wadliwie lub sprzecznie z umową, wad gotowego dzieła i odstąpienia od umowy stosuje się właściwe przepisy Kodeksu cywilnego, w szczególności art. 635, 636, 638 i 644. Umowa nie wyłącza uprawnień wynikających z przepisów bezwzględnie obowiązujących.

§ 6. Prawa do rezultatu
Przekazanie egzemplarza dzieła nie stanowi automatycznie przeniesienia autorskich praw majątkowych ani udzielenia licencji wyłącznej. Jeżeli rezultat jest utworem, zakres korzystania wymaga odrębnego uzgodnienia odpowiednich praw, pól eksploatacji i wynagrodzenia, z zachowaniem formy wymaganej prawem. Niniejszy wzór nie przewiduje automatycznego zastosowania 50% kosztów uzyskania przychodu.

§ 7. Postanowienia końcowe
Dodatkowe ustalenia: {{ustalenia}}
Zamawiający dokonuje zgłoszenia RUD w terminie 7 dni od zawarcia umowy, jeżeli wynika to z przepisów i nie zachodzi ustawowy wyjątek. W sprawach nieuregulowanych stosuje się przepisy Kodeksu cywilnego o umowie o dzieło. Zmiany strony dokumentują w sposób pozwalający ustalić ich treść, z zachowaniem formy wymaganej prawem. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej strony.

Zamawiający: __________________________
Wykonawca: __________________________$template$);

INSERT INTO public.personnel_contract_templates(name,contract_kind,content) VALUES ('Umowa zlecenie — standard 2026','mandate',$template$UMOWA ZLECENIE NR {{numer}}

Zawarta dnia {{data_zawarcia}} pomiędzy:
{{zleceniodawca}}, z siedzibą: {{adres_zleceniodawcy}}, NIP {{nip_zleceniodawcy}}, reprezentowaną przez: {{reprezentacja}},
a
{{osoba}}, adres: {{adres_osoby}}, identyfikator: {{identyfikator}}.

Pierwsza ze stron jest dalej nazywana Zleceniodawcą, druga Zleceniobiorcą. {{forma_ustalen}}

§ 1. Przedmiot i sposób wykonania
Zleceniodawca zleca, a Zleceniobiorca zobowiązuje się z należytą starannością wykonać następujące czynności:
{{zakres}}
Miejsce wykonywania czynności: {{miejsce}}.
Zakres współpracy: {{realizacja}}.

Zleceniobiorca wykonuje czynności samodzielnie, z uwzględnieniem uzgodnionych wymagań realizacji oraz zasad bezpieczeństwa obowiązujących w miejscu ich wykonywania. Powierzenie wykonania osobie trzeciej następuje na zasadach art. 738 Kodeksu cywilnego. Strony nie mogą posługiwać się niniejszą umową w celu zastąpienia stosunku pracy, jeżeli faktyczny sposób wykonywania czynności spełnia przesłanki art. 22 Kodeksu pracy.

§ 2. Okres współpracy
{{okres_umowy}}
Rozpoczęcie wykonywania czynności: {{od}}.

§ 3. Wynagrodzenie
Strony ustalają następujące stawki oraz okresy ich obowiązywania:
{{wynagrodzenie}}

Stawka godzinowa jest mnożona przez udokumentowaną liczbę godzin, miesięczna dotyczy miesiąca rozliczeniowego, stawka akordowa jest mnożona przez przyjętą liczbę wskazanych jednostek, a kwota za całość dotyczy wykonania całego zakresu umowy. Stosuje się wyłącznie sposób wynagradzania wskazany powyżej. Oznaczenie „netto” określa kwotę należną Zleceniobiorcy po obowiązkowych potrąceniach; odpowiadające jej brutto ustala się dla danej wypłaty według obowiązujących przepisów i aktualnych danych osoby.

Jeżeli do umowy stosuje się ustawową minimalną stawkę godzinową, wynagrodzenie za każdą godzinę nie może być od niej niższe, także przy stawce miesięcznej, kwocie za całość lub akordzie. W razie potrzeby Zleceniodawca dopłaci wyrównanie. Zleceniobiorca nie zrzeka się wynagrodzenia w wysokości objętej tą ochroną ani nie przenosi prawa do niego na inną osobę.

§ 4. Ewidencja i wypłata
Sposób potwierdzania godzin: {{ewidencja_godzin}}
Cykl rozliczeń: {{rozliczenie}}.
Termin i dodatkowe warunki płatności: {{warunki_platnosci}}
Sposób wypłaty: {{sposob_wyplaty}}.
{{rachunek}}

Przy umowie zawartej na okres dłuższy niż miesiąc wynagrodzenie objęte minimalną stawką godzinową jest wypłacane co najmniej raz w miesiącu. Ewidencja godzin służy także kontroli minimalnego wynagrodzenia przy akordzie. Brak zatwierdzenia ewidencji nie pozbawia prawa do wynagrodzenia za rzeczywiście wykonane czynności.

§ 5. Podatki, ubezpieczenia i wydatki
{{podatki_skladki}}
Zleceniobiorca przekazuje zgodne z prawdą dane i informuje o zmianach mających wpływ na rozliczenie. Zleceniodawca zwraca niezbędne, uzasadnione wydatki poniesione w celu należytego wykonania zlecenia oraz zwalnia Zleceniobiorcę z zaciągniętych w tym celu zobowiązań zgodnie z art. 742 Kodeksu cywilnego.

§ 6. Zakończenie współpracy
Każda ze stron może wypowiedzieć zlecenie na zasadach art. 746 Kodeksu cywilnego, z rozliczeniem wykonanych czynności, wydatków i ewentualnej odpowiedzialności przewidzianej w tym przepisie. Nie wyłącza się prawa do wypowiedzenia z ważnych powodów. Oświadczenie o wypowiedzeniu należy przekazać drugiej stronie w sposób pozwalający potwierdzić jego treść i otrzymanie.

§ 7. Postanowienia końcowe
Dodatkowe ustalenia: {{ustalenia}}
W sprawach nieuregulowanych stosuje się Kodeks cywilny, w tym przepisy o zleceniu i, w odpowiednim przypadku, art. 750, oraz bezwzględnie obowiązujące przepisy o minimalnym wynagrodzeniu. Zmiany ustaleń strony dokumentują w sposób pozwalający ustalić ich treść, z zachowaniem formy wymaganej prawem. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej strony.

Zleceniodawca: __________________________
Zleceniobiorca: __________________________$template$);

COMMIT;
