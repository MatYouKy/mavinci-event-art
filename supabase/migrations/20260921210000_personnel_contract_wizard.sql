BEGIN;

-- Questionnaire lives with the contract and is copied into the existing immutable snapshots.
CREATE OR REPLACE FUNCTION public.personnel_questionnaire_date(value text, label text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result date;
BEGIN
 IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Podaj prawidłową datę: %',label; END IF;
 BEGIN result:=value::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Popraw datę: %',label; END;
 IF to_char(result,'YYYY-MM-DD')<>value THEN RAISE EXCEPTION 'Popraw datę: %',label; END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.personnel_questionnaire_settings(c public.personnel_contracts)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 q jsonb:=c.payroll_profile->'questionnaire'; a jsonb:=q->'answers'; s jsonb:=c.net_cost_settings;
 labels jsonb:=$json${"work_nature":"Na czym ma polegać współpraca?","supervision":"Czy osoba ma pracować pod kierownictwem firmy, w wyznaczonym przez nią miejscu i czasie?","result_check":"Czy rezultat można opisać, odebrać i sprawdzić pod kątem wad?","birth_date":"Data urodzenia osoby","citizenship":"Czy osoba ma obywatelstwo polskie?","residency":"Gdzie osoba rozlicza się jako rezydent podatkowy?","foreign_insurance":"Czy osoba pracuje za granicą, ma zagraniczne ubezpieczenie lub dokument A1?","own_employer":"Czy osoba ma już umowę o pracę z działalnością wybraną w tej umowie?","for_employer":"Czy wykonana praca będzie służyć jej obecnemu pracodawcy, nawet jeśli umowę podpisuje z Mavinci?","education":"Jaki jest aktualny status nauki?","education_from":"Status ucznia / studenta potwierdzony od","education_to":"Do kiedy potwierdzono ciągłość tego statusu?","education_proof":"Dokument potwierdzający status i jego ciągłość","other_employment":"Czy w tym okresie osoba ma etat w innej firmie?","employment_from":"Początek etatu w innej firmie","employment_to":"Do kiedy potwierdzono trwanie etatu?","employment_pay":"Czy w innym etacie zagwarantowano stałe miesięczne wynagrodzenie brutto?","employment_gross":"Gwarantowane miesięczne brutto u innego pracodawcy","employment_break":"Czy występuje urlop bezpłatny, wychowawczy lub pobieranie zasiłku macierzyńskiego?","other_mandates":"Czy osoba ma inne zlecenia lub umowy o świadczenie usług, także w Mavinci?","business":"Czy prowadzi działalność gospodarczą lub jest wspólnikiem objętym ubezpieczeniami?","pension":"Czy pobiera emeryturę, rentę lub inne świadczenie wpływające na ubezpieczenia?","krus":"Czy jest ubezpieczona w KRUS?","krus_notified":"Czy zgłoszono umowę do KRUS i potwierdzono sytuację rolnika / domownika?","other_status":"Czy są inne okoliczności: służba mundurowa, urlopy, ubezpieczenie duchownych lub szczególny tytuł?","declaration_from":"Oświadczenie o sytuacji osoby obowiązuje od","declaration_to":"Oświadczenie o sytuacji osoby obowiązuje do","declaration_source":"Skąd pochodzą te informacje?","youth_opt_out":"Czy osoba złożyła wniosek, aby nie stosować ulgi dla młodych?","youth_remaining":"Ile zostało ze wspólnego rocznego limitu 85 528 zł?","pit2":"Jakie pomniejszenie zaliczki osoba wskazała w PIT-2 dla Mavinci?","pit2_elsewhere":"Łączne pomniejszenie zaliczki u pozostałych płatników w tym miesiącu","pit32":"Czy osoba złożyła wniosek o pobieranie zaliczek według stawki 32%?","tax_reliefs":"Czy zgłoszono inne ulgi lub szczególne zasady PIT?","copyright":"Czy umowa obejmuje przeniesienie praw autorskich, licencję wyłączną lub 50% kosztów uzyskania przychodu?","ppk":"Jaki jest potwierdzony status PPK?","deductions":"Czy są zajęcia komornicze, inne potrącenia, świadczenia rzeczowe lub dodatkowe składniki wypłaty?","annual_limit":"Czy osiągnięto lub można osiągnąć w tej wypłacie roczny limit składek emerytalnych i rentowych?","sex":"Płeć wskazana w dokumentach do ubezpieczeń","fund_exemption":"Czy osoba ma co najmniej 55 lat (kobieta) / 60 lat (mężczyzna) albo inne zwolnienie z funduszy pracowniczych?","sickness":"Czy osoba wnosi o dobrowolne ubezpieczenie chorobowe ze zlecenia?","additional_payment":"Czy w miesiącu planowanej wypłaty będzie inna wypłata lub zaliczka z tej umowy?","employment_payroll":"Czy rozliczenie etatu obejmuje niepełny miesiąc, absencje, nadgodziny, premie lub zmianę progu podatkowego?","employment_kup":"Jakie koszty pracownicze wynikają z oświadczenia?","term_history":"Czy sprawdzono wcześniejsze umowy terminowe i dopuszczalność obecnego okresu?","planned_hours":"Ile godzin pracy obejmuje ta wypłata?","voluntary_social":"Czy osoba chce przystąpić dobrowolnie do ubezpieczeń emerytalnego i rentowych ze zlecenia mimo etatu w innej firmie?","small_contract":"Czy należność określona w CAŁEJ umowie wynosi najwyżej 200 zł brutto?","employer_rates":"Czy stawkę wypadkową i obowiązek FGŚP potwierdzono dla wybranej działalności?","accident_rate":"Potwierdzona stawka wypadkowa (%)","fgsp":"Czy firma ma naliczać FGŚP za tę osobę?","fund_mode":"Jak ustalono Fundusz Pracy i Solidarnościowy dla tej wypłaty?","company_source":"Źródło potwierdzenia składek firmy"}$json$::jsonb; choices jsonb:=$json${"work_nature":["services","result","employment","unknown"],"supervision":["no","yes","unknown"],"result_check":["no","yes","unknown"],"citizenship":["PL","other","unknown"],"residency":["PL","other","unknown"],"foreign_insurance":["no","yes","unknown"],"own_employer":["no","yes","unknown"],"for_employer":["no","yes","unknown"],"education":["none","pupil","student","other","unknown"],"other_employment":["no","one","multiple","unknown"],"employment_pay":["fixed","variable","unknown"],"employment_break":["no","yes","unknown"],"other_mandates":["no","yes","unknown"],"business":["no","yes","unknown"],"pension":["no","yes","unknown"],"krus":["no","yes","unknown"],"krus_notified":["no","yes","unknown"],"other_status":["no","yes","unknown"],"youth_opt_out":["no","yes","unknown"],"pit2":["0","100","150","300","unknown"],"pit32":["no","yes","unknown"],"tax_reliefs":["no","yes","unknown"],"copyright":["no","yes","unknown"],"ppk":["none","yes","unknown"],"deductions":["no","yes","unknown"],"annual_limit":["no","yes","unknown"],"sex":["female","male","unknown"],"fund_exemption":["no","yes","unknown"],"sickness":["no","yes","unknown"],"additional_payment":["no","yes","unknown"],"employment_payroll":["no","yes","unknown"],"employment_kup":["250","300","0","unknown"],"term_history":["no","yes","unknown"],"voluntary_social":["no","yes","unknown"],"small_contract":["no","yes","unknown"],"employer_rates":["no","yes","unknown"],"fgsp":["no","yes","unknown"],"fund_mode":["auto","yes","no","unknown"]}$json$::jsonb;
 required_keys text[]; key text; value text; numeric_keys text[];
 work_from date; work_to date; paid date; born date; turn26 date; declared_from date; declared_to date;
 student boolean:=false; health_only boolean:=false; social boolean; minimum numeric; monthly_gross numeric;
 insurance text; own_employer text; education text; result jsonb;
BEGIN
 IF coalesce(q->>'version','')<>'1' OR coalesce(q->>'confirmed','false')<>'true' OR jsonb_typeof(a) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Uzupełnij i potwierdź podsumowanie kreatora umowy'; END IF;
 IF c.party_kind IS DISTINCT FROM 'person' OR c.currency<>'PLN' THEN RAISE EXCEPTION 'Firma lub waluta obca wymaga indywidualnego rozliczenia; zachowaj szkic'; END IF;
 work_from:=public.personnel_questionnaire_date(s->>'work_from','początek pracy do kalkulacji');
 work_to:=public.personnel_questionnaire_date(s->>'work_to','koniec pracy do kalkulacji');
 paid:=public.personnel_questionnaire_date(s->>'payment_date','data wypłaty');
 IF extract(year FROM paid)<>2026 THEN RAISE EXCEPTION 'Reguły kalkulatora dotyczą wypłat w 2026 r.; inny rok wymaga aktualizacji'; END IF;
 IF work_to<work_from OR date_trunc('month',work_from)<>date_trunc('month',work_to) OR work_from<c.start_date OR (c.end_date IS NOT NULL AND work_to>c.end_date) OR paid<work_to THEN RAISE EXCEPTION 'Kalkulacja wymaga jednego miesiąca pracy w okresie umowy i wypłaty nie wcześniejszej od końca tej pracy'; END IF;
 SELECT employment_monthly INTO minimum FROM public.personnel_statutory_rates WHERE year=extract(year FROM work_from);
 IF minimum IS NULL OR extract(year FROM work_from)<>2026 THEN RAISE EXCEPTION 'Brak obsługiwanych reguł dla tego okresu pracy'; END IF;
 required_keys:=ARRAY['work_nature','birth_date','citizenship','residency','foreign_insurance','other_employment','other_mandates','business','pension','krus','other_status','declaration_from','declaration_to','declaration_source','pit2','pit32','tax_reliefs','copyright','ppk','deductions','annual_limit','fund_exemption','additional_payment'];
 IF c.contract_kind<>'employment' THEN required_keys:=required_keys||ARRAY['supervision','own_employer','for_employer','small_contract']; END IF;
 IF c.contract_kind='mandate' THEN required_keys:=required_keys||ARRAY['education','planned_hours']; END IF;
 IF c.contract_kind='specific_work' THEN required_keys:=array_append(required_keys,'result_check'); END IF;
 IF c.contract_kind='employment' THEN required_keys:=required_keys||ARRAY['employment_payroll','employment_kup','term_history']; END IF;
 IF a->>'other_employment'='one' THEN
  required_keys:=required_keys||ARRAY['employment_from','employment_to','employment_pay','employment_break'];
  IF a->>'employment_pay'='fixed' THEN required_keys:=array_append(required_keys,'employment_gross'); END IF;
 END IF;
 IF c.contract_kind='mandate' AND a->>'education' IN ('pupil','student') THEN required_keys:=required_keys||ARRAY['education_from','education_to','education_proof']; END IF;
 IF a->>'krus'='yes' THEN required_keys:=array_append(required_keys,'krus_notified'); END IF;
 IF a->>'pit2' IN ('100','150','300') THEN required_keys:=array_append(required_keys,'pit2_elsewhere'); END IF;
 born:=public.personnel_questionnaire_date(a->>'birth_date','data urodzenia'); turn26:=(born+interval '26 years')::date;
 IF work_from<(born+interval '18 years')::date THEN RAISE EXCEPTION 'Osoba niepełnoletnia wymaga indywidualnego ustalenia warunków'; END IF;
 IF work_to>=(born+interval '55 years')::date THEN required_keys:=array_append(required_keys,'sex'); END IF;
 IF c.contract_kind<>'specific_work' AND paid<=turn26 THEN
  required_keys:=array_append(required_keys,'youth_opt_out');
  IF a->>'youth_opt_out'='no' THEN required_keys:=array_append(required_keys,'youth_remaining'); END IF;
 END IF;
 FOREACH key IN ARRAY required_keys LOOP
  value:=a->>key;
  IF nullif(btrim(value),'') IS NULL OR value='unknown' THEN RAISE EXCEPTION 'Uzupełnij lub wyjaśnij: %',labels->>key; END IF;
  IF choices ? key AND NOT (choices->key ? value) THEN RAISE EXCEPTION 'Wybierz prawidłową odpowiedź: %',labels->>key; END IF;
 END LOOP;
 numeric_keys:=ARRAY['employment_gross','pit2_elsewhere','youth_remaining','planned_hours'];
 FOREACH key IN ARRAY numeric_keys LOOP
  IF key=ANY(required_keys) AND coalesce(a->>key,'')!~ '^\d+(\.\d+)?$' THEN RAISE EXCEPTION 'Podaj nieujemną liczbę: %',labels->>key; END IF;
 END LOOP;
 IF a->>'work_nature' IS DISTINCT FROM (CASE c.contract_kind WHEN 'employment' THEN 'employment' WHEN 'specific_work' THEN 'result' ELSE 'services' END) THEN RAISE EXCEPTION 'Rodzaj umowy nie odpowiada opisowi współpracy'; END IF;
 IF c.contract_kind<>'employment' AND a->>'supervision'='yes' THEN RAISE EXCEPTION 'Warunki mogą wskazywać na stosunek pracy; ustal właściwy rodzaj umowy'; END IF;
 IF c.contract_kind='specific_work' AND a->>'result_check'<>'yes' THEN RAISE EXCEPTION 'Dzieło wymaga indywidualnego, sprawdzalnego rezultatu'; END IF;
 IF a->>'citizenship'<>'PL' OR a->>'residency'<>'PL' THEN RAISE EXCEPTION 'Cudzoziemiec lub nierezydent wymaga ustalenia dokumentów i zasad rozliczenia'; END IF;
 FOREACH key IN ARRAY ARRAY['foreign_insurance','other_mandates','business','pension','other_status','tax_reliefs','copyright','deductions','annual_limit','fund_exemption','additional_payment','employment_payroll'] LOOP
  IF key=ANY(required_keys) AND a->>key='yes' THEN RAISE EXCEPTION 'Potrzebne indywidualne ustalenie: %. Zapisz szkic i przekaż listę pytań do rozliczenia.',labels->>key; END IF;
 END LOOP;
 IF work_to>=(born+interval '60 years')::date OR (a->>'sex'='female' AND work_to>=(born+interval '55 years')::date) THEN RAISE EXCEPTION 'Wiek wskazuje na zwolnienie z funduszy; potwierdź jego początek i zasady z księgowością'; END IF;
 IF a->>'ppk'<>'none' THEN RAISE EXCEPTION 'PPK wymaga odrębnego rozliczenia wpłat i przychodu'; END IF;
 IF c.contract_kind<>'employment' AND (a->>'own_employer'<>'no' OR a->>'for_employer'<>'no') THEN RAISE EXCEPTION 'Praca dla własnego pracodawcy wymaga łącznego rozliczenia z etatem'; END IF;
 IF a->>'other_employment'='multiple' THEN RAISE EXCEPTION 'Kilka etatów wymaga ustalenia łącznych podstaw i okresów'; END IF;
 IF a->>'krus'='yes' AND a->>'krus_notified'<>'yes' THEN RAISE EXCEPTION 'Potwierdź zgłoszenie i sytuację ubezpieczeniową w KRUS'; END IF;
 IF c.contract_kind='employment' AND a->>'term_history'<>'yes' THEN RAISE EXCEPTION 'Sprawdź wcześniejsze umowy i dopuszczalność obecnego okresu'; END IF;
 declared_from:=public.personnel_questionnaire_date(a->>'declaration_from','początek oświadczenia');
 declared_to:=public.personnel_questionnaire_date(a->>'declaration_to','koniec oświadczenia');
 IF declared_from>work_from OR declared_to<work_to OR declared_to<declared_from THEN RAISE EXCEPTION 'Oświadczenie musi obejmować cały okres rozliczanej pracy'; END IF;
 IF a->>'other_employment'='one' THEN
  IF a->>'employment_pay'<>'fixed' OR a->>'employment_break'<>'no' THEN RAISE EXCEPTION 'Zmienne wynagrodzenie, urlop lub zasiłek w innym etacie wymaga ustalenia podstaw za miesiąc'; END IF;
  IF public.personnel_questionnaire_date(a->>'employment_from','początek innego etatu')>work_from OR public.personnel_questionnaire_date(a->>'employment_to','potwierdzenie innego etatu do')<work_to THEN RAISE EXCEPTION 'Inny etat musi być potwierdzony przez cały rozliczany okres'; END IF;
  monthly_gross:=(a->>'employment_gross')::numeric;
  IF monthly_gross<=0 THEN RAISE EXCEPTION 'Podaj dodatnie gwarantowane brutto z etatu'; END IF;
 END IF;
 IF c.contract_kind='mandate' AND a->>'education' IN ('pupil','student') THEN
  IF work_from<turn26 AND work_to>=turn26 THEN RAISE EXCEPTION 'Podziel okres na granicy 26. urodzin'; END IF;
  IF work_to<turn26 THEN
   IF public.personnel_questionnaire_date(a->>'education_from','początek statusu ucznia / studenta')>work_from OR public.personnel_questionnaire_date(a->>'education_to','koniec statusu ucznia / studenta')<work_to THEN RAISE EXCEPTION 'Status ucznia / studenta musi obejmować cały okres pracy'; END IF;
   student:=true;
  END IF;
 END IF;
 health_only:=c.contract_kind='mandate' AND NOT student AND a->>'other_employment'='one' AND coalesce(monthly_gross>=minimum,false);
 social:=c.contract_kind='employment' OR (c.contract_kind='mandate' AND NOT student AND NOT health_only);
 required_keys:=ARRAY[]::text[];
 IF social THEN required_keys:=ARRAY['employer_rates','accident_rate','fgsp','fund_mode','company_source']; END IF;
 IF social AND c.contract_kind='mandate' THEN required_keys:=array_append(required_keys,'sickness'); END IF;
 IF health_only THEN required_keys:=array_append(required_keys,'voluntary_social'); END IF;
 FOREACH key IN ARRAY required_keys LOOP
  value:=a->>key;
  IF nullif(btrim(value),'') IS NULL OR value='unknown' THEN RAISE EXCEPTION 'Uzupełnij lub wyjaśnij: %',labels->>key; END IF;
  IF choices ? key AND NOT (choices->key ? value) THEN RAISE EXCEPTION 'Wybierz prawidłową odpowiedź: %',labels->>key; END IF;
 END LOOP;
 IF health_only AND a->>'voluntary_social'<>'no' THEN RAISE EXCEPTION 'Dobrowolne składki przy zbiegu tytułów wymagają indywidualnego zgłoszenia'; END IF;
 IF social THEN
  IF a->>'employer_rates'<>'yes' THEN RAISE EXCEPTION 'Potwierdź stawki składek firmy na podstawie rozliczenia księgowego'; END IF;
  IF coalesce(a->>'accident_rate','')!~ '^\d+(\.\d+)?$' THEN RAISE EXCEPTION 'Podaj prawidłową stawkę wypadkową'; END IF;
  IF (a->>'accident_rate')::numeric NOT BETWEEN 0.67 AND 3.33 THEN RAISE EXCEPTION 'Sprawdź stawkę wypadkową'; END IF;
  IF a->>'fund_mode'='auto' AND (extract(day FROM work_from)<>1 OR work_to<>(date_trunc('month',work_to)+interval '1 month - 1 day')::date OR a->>'other_employment'<>'no') THEN RAISE EXCEPTION 'Dla części miesiąca lub innych podstaw potwierdź FP/FS z księgowością'; END IF;
 END IF;
 IF a->>'pit2' IN ('100','150','300') AND (a->>'pit2')::numeric+(a->>'pit2_elsewhere')::numeric>300 THEN RAISE EXCEPTION 'Łączne pomniejszenie PIT-2 u płatników przekracza 300 zł'; END IF;
 IF c.contract_kind<>'specific_work' AND paid<=turn26 AND a->>'youth_opt_out'='no' AND (a->>'youth_remaining')::numeric>85528 THEN RAISE EXCEPTION 'Pozostały limit ulgi przekracza 85 528 zł'; END IF;
 IF c.contract_kind='mandate' THEN
  IF (a->>'planned_hours')::numeric<=0 THEN RAISE EXCEPTION 'Podaj dodatnią liczbę godzin do sprawdzenia minimum'; END IF;
  IF s->>'basis'='hourly' AND (s->>'quantity')::numeric<>(a->>'planned_hours')::numeric THEN RAISE EXCEPTION 'Liczba godzin w planie netto i do minimum musi być zgodna'; END IF;
 END IF;
 IF c.planned_net_amount IS NULL OR c.planned_net_amount<=0 THEN RAISE EXCEPTION 'Uzupełnij planowane wynagrodzenie netto'; END IF;
 IF coalesce(s->>'basis','') NOT IN ('monthly','hourly','fixed','piecework') THEN RAISE EXCEPTION 'Wskaż, czego dotyczy kwota netto'; END IF;
 IF s->>'basis' IN ('hourly','piecework') THEN
  IF coalesce(s->>'quantity','')!~ '^\d+(\.\d+)?$' THEN RAISE EXCEPTION 'Podaj liczbę godzin / jednostek'; END IF;
  IF (s->>'quantity')::numeric<=0 THEN RAISE EXCEPTION 'Liczba jednostek musi być dodatnia'; END IF;
 END IF;
 IF c.contract_kind='employment' AND s->>'basis'<>'monthly' OR c.contract_kind='specific_work' AND s->>'basis'<>'fixed' OR c.contract_kind='mandate' AND c.settlement_cycle='monthly' AND s->>'basis'='fixed' THEN RAISE EXCEPTION 'Sposób naliczania nie pasuje do rodzaju i cyklu umowy'; END IF;
 IF c.contract_kind<>'employment' AND a->>'small_contract'='yes' AND s->>'basis'<>'fixed' THEN RAISE EXCEPTION 'Ryczałt do 200 zł wymaga należności określonej za całą umowę'; END IF;
 insurance:=CASE WHEN student THEN 'auto' WHEN health_only THEN 'health_only' ELSE 'social_health' END;
 result:=jsonb_build_object('insurance',insurance,'sickness',social AND c.contract_kind='mandate' AND a->>'sickness'='yes','pit_credit',a->>'pit2','pit_rate',CASE WHEN a->>'pit32'='yes' THEN '32' ELSE '12' END,'employment_kup',CASE WHEN c.contract_kind='employment' THEN a->>'employment_kup' ELSE '250' END,'youth_remaining',CASE WHEN c.contract_kind<>'specific_work' AND paid<=turn26 AND a->>'youth_opt_out'='no' THEN a->>'youth_remaining' ELSE '' END,'small_contract',c.contract_kind<>'employment' AND a->>'small_contract'='yes','accident_rate',CASE WHEN social THEN a->>'accident_rate' ELSE '1.67' END,'fgsp',social AND a->>'fgsp'='yes','labour_fund',CASE WHEN social THEN a->>'fund_mode' ELSE 'auto' END);
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_personnel_questionnaire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; settings jsonb; unchanged boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  unchanged:=(to_jsonb(NEW)-ARRAY['status','notes','updated_at','end_date','employee_id','person_id']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','notes','updated_at','end_date','employee_id','person_id']);
  -- Allow archiving and notes on existing records without retroactively rewriting their history.
  IF unchanged AND OLD.status<>'draft' AND NEW.status<>'draft' THEN RETURN NEW; END IF;
 END IF;
 IF NEW.payroll_profile ? 'questionnaire' THEN
  a:=NEW.payroll_profile->'questionnaire'->'answers';
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe odpowiedzi kreatora'; END IF;
  NEW.payroll_profile:=NEW.payroll_profile||jsonb_build_object('birth_date',coalesce(a->>'birth_date',''),'education',CASE a->>'education' WHEN 'other' THEN 'none' ELSE coalesce(a->>'education','unknown') END,'education_from',coalesce(a->>'education_from',''),'education_to',coalesce(a->>'education_to',''),'tax_residency',coalesce(a->>'residency','unknown'),'own_employer',CASE WHEN a->>'own_employer'='yes' OR a->>'for_employer'='yes' THEN 'yes' WHEN a->>'own_employer'='no' AND a->>'for_employer'='no' THEN 'no' ELSE 'unknown' END,'youth_opt_out',coalesce(a->>'youth_opt_out','unknown'));
 END IF;
 IF NEW.status<>'draft' OR NEW.payroll_profile->'questionnaire'->>'confirmed'='true' THEN
  settings:=public.personnel_questionnaire_settings(NEW);
  NEW.net_cost_settings:=NEW.net_cost_settings||settings;
  IF nullif(btrim(NEW.party_address),'') IS NULL OR nullif(btrim(NEW.work_scope),'') IS NULL OR nullif(btrim(NEW.issuer_representative),'') IS NULL OR nullif(btrim(NEW.payment_terms),'') IS NULL THEN RAISE EXCEPTION 'Uzupełnij adres, reprezentację, zakres i termin płatności w kroku 2'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_personnel_questionnaire_guard BEFORE INSERT OR UPDATE ON public.personnel_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_questionnaire();

CREATE OR REPLACE FUNCTION public.guard_personnel_questionnaire_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts;
BEGIN
 SELECT * INTO c FROM public.personnel_contracts WHERE id=NEW.contract_id FOR UPDATE;
 PERFORM public.personnel_questionnaire_settings(c);
 RETURN NEW;
END; $$;
CREATE TRIGGER personnel_questionnaire_document BEFORE INSERT ON public.personnel_contract_documents FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_questionnaire_document();

CREATE OR REPLACE FUNCTION public.guard_personnel_questionnaire_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; settings jsonb; snapshot jsonb:=NEW.payroll_snapshot; a jsonb; first_work date; last_work date; student boolean;
BEGIN
 SELECT * INTO c FROM public.personnel_contracts WHERE id=NEW.contract_id FOR UPDATE;
 settings:=public.personnel_questionnaire_settings(c);a:=c.payroll_profile->'questionnaire'->'answers';
 SELECT min(work_date),max(work_date) INTO first_work,last_work FROM public.personnel_work_items WHERE contract_id=c.id AND work_date>=NEW.period AND work_date<NEW.period+interval '1 month';
 IF left(c.net_cost_settings->>'work_from',7)<>to_char(NEW.period,'YYYY-MM') OR left(c.net_cost_settings->>'work_to',7)<>to_char(NEW.period,'YYYY-MM') OR c.net_cost_settings->>'payment_date' IS DISTINCT FROM snapshot->>'payment_date' THEN RAISE EXCEPTION 'Zaktualizuj kreator i oświadczenie dla miesiąca oraz daty tej wypłaty'; END IF;
 IF first_work IS NOT NULL AND (first_work<(c.net_cost_settings->>'work_from')::date OR last_work>(c.net_cost_settings->>'work_to')::date) THEN RAISE EXCEPTION 'Oświadczenie i okres kalkulacji nie obejmują wszystkich rozliczanych wpisów'; END IF;
 student:=c.contract_kind='mandate' AND settings->>'insurance'='auto';
 IF student OR c.contract_kind='specific_work' THEN
  IF coalesce((snapshot->>'social')::numeric,0)<>0 OR coalesce((snapshot->>'health')::numeric,0)<>0 OR coalesce((snapshot->>'employer')::numeric,0)<>0 THEN RAISE EXCEPTION 'Kwoty składek nie odpowiadają potwierdzonemu zwolnieniu; popraw dane albo rozliczenie'; END IF;
 ELSIF settings->>'insurance'='health_only' THEN
  IF coalesce((snapshot->>'social')::numeric,0)<>0 OR coalesce((snapshot->>'employer')::numeric,0)<>0 THEN RAISE EXCEPTION 'Wybrany zbieg przewiduje tylko zdrowotną; popraw rozliczenie albo odpowiedzi'; END IF;
 END IF;
 IF coalesce(snapshot->>'student_exempt','false') IS DISTINCT FROM student::text THEN RAISE EXCEPTION 'Oznaczenie zwolnienia studenta nie odpowiada potwierdzonym danym'; END IF;
 IF settings->>'small_contract'='true' AND (snapshot->>'tax_scheme'<>'flat' OR NEW.gross_amount>200) THEN RAISE EXCEPTION 'Sprawdź ryczałt dla całej należności do 200 zł brutto'; END IF;
 IF settings->>'small_contract'='false' AND snapshot->>'tax_scheme'<>'scale' THEN RAISE EXCEPTION 'Sposób opodatkowania nie odpowiada odpowiedziom kreatora'; END IF;
 NEW.payroll_snapshot:=snapshot||jsonb_build_object('questionnaire',c.payroll_profile->'questionnaire','questionnaire_rules_version','PL-2026-09-21-v1','derived_settings',settings);
 RETURN NEW;
END; $$;
CREATE TRIGGER personnel_questionnaire_settlement BEFORE INSERT ON public.personnel_settlements FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_questionnaire_settlement();

REVOKE ALL ON FUNCTION public.personnel_questionnaire_date(text,text),public.personnel_questionnaire_settings(public.personnel_contracts),public.guard_personnel_questionnaire(),public.guard_personnel_questionnaire_document(),public.guard_personnel_questionnaire_settlement() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
