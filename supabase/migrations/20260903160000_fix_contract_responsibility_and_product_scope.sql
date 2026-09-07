/*
  Oddziela odpowiedzialność i bezpieczeństwo od paragrafu o rezygnacji oraz
  usuwa z klauzul produktów sztywne ilości i okresy, które mogą być inne w ofercie.
*/

DO $migration$
DECLARE
  responsibility_plain text := E'§ 8\nOdpowiedzialność i bezpieczeństwo\n1. Strony ponoszą odpowiedzialność za niewykonanie lub nienależyte wykonanie umowy na zasadach wynikających z przepisów prawa, z uwzględnieniem statusu danej Strony oraz odpowiedzialności za osoby, którymi posługuje się przy wykonaniu umowy.\n2. Zamawiający odpowiada za zachowanie uczestników i osób działających po jego stronie w zakresie, w jakim przepisy prawa przypisują mu odpowiedzialność, oraz zapewnia, aby nie ingerowali oni bez upoważnienia w sprzęt, instalacje i strefy techniczne Wykonawcy.\n3. Wykonawca może wstrzymać lub ograniczyć realizację w zakresie niezbędnym do usunięcia bezpośredniego zagrożenia dla życia, zdrowia albo mienia, informując o tym przedstawiciela Zamawiającego.\n4. Zamawiający powinien zgłaszać zauważone nieprawidłowości niezwłocznie, w miarę możliwości jeszcze podczas wydarzenia, aby umożliwić Wykonawcy ich ocenę i usunięcie. Nie narusza to ustawowych uprawnień Zamawiającego.\n5. Ryzyka charakterystyczne dla zamówionych produktów i wariantów określają poniższe klauzule:';
  responsibility_html text := $html$
<p data-contract-paragraph="true" data-contract-keep-with-next="true" style="font-family:Arial,sans-serif;font-size:8.5pt;line-height:1.5;margin:8pt 0 2pt;text-align:center;font-weight:700;">§ 8</p>
<p data-contract-keep-with-next="true" style="font-family:Arial,sans-serif;font-size:8.5pt;line-height:1.5;margin:0 0 5pt;text-align:center;font-weight:700;">Odpowiedzialność i bezpieczeństwo</p>
<ol style="font-family:Arial,sans-serif;font-size:8.5pt;line-height:1;margin:0 0 7pt;padding-left:20pt;text-align:justify;" start="1">
  <li style="margin:0 0 4pt;font-size:11.3333px;font-family:Arial,sans-serif;font-weight:400;line-height:1.5;">Strony ponoszą odpowiedzialność za niewykonanie lub nienależyte wykonanie umowy na zasadach wynikających z przepisów prawa, z uwzględnieniem statusu danej Strony oraz odpowiedzialności za osoby, którymi posługuje się przy wykonaniu umowy.</li>
  <li style="margin:0 0 4pt;font-size:11.3333px;font-family:Arial,sans-serif;font-weight:400;line-height:1.5;">Zamawiający odpowiada za zachowanie uczestników i osób działających po jego stronie w zakresie, w jakim przepisy prawa przypisują mu odpowiedzialność, oraz zapewnia, aby nie ingerowali oni bez upoważnienia w sprzęt, instalacje i strefy techniczne Wykonawcy.</li>
  <li style="margin:0 0 4pt;font-size:11.3333px;font-family:Arial,sans-serif;font-weight:400;line-height:1.5;">Wykonawca może wstrzymać lub ograniczyć realizację w zakresie niezbędnym do usunięcia bezpośredniego zagrożenia dla życia, zdrowia albo mienia, informując o tym przedstawiciela Zamawiającego.</li>
  <li style="margin:0 0 4pt;font-size:11.3333px;font-family:Arial,sans-serif;font-weight:400;line-height:1.5;">Zamawiający powinien zgłaszać zauważone nieprawidłowości niezwłocznie, w miarę możliwości jeszcze podczas wydarzenia, aby umożliwić Wykonawcy ich ocenę i usunięcie. Nie narusza to ustawowych uprawnień Zamawiającego.</li>
  <li style="margin:0 0 4pt;font-size:11.3333px;font-family:Arial,sans-serif;font-weight:400;line-height:1.5;">Ryzyka charakterystyczne dla zamówionych produktów i wariantów określają poniższe klauzule:</li>
</ol>
$html$;
BEGIN
  UPDATE public.contract_templates
  SET
    content = regexp_replace(
      content,
      'wynikających z przepisów prawa[^§]*Ryzyka charakterystyczne dla zamówionych produktów i wariantów określają poniższe klauzule:',
      responsibility_plain
    ),
    content_html = regexp_replace(
      content_html,
      '<ol[^>]*start="4"[^>]*>[[:space:]]*<li[^>]*>wynikających z przepisów prawa[^<]*Ryzyka charakterystyczne dla zamówionych produktów i wariantów określają poniższe klauzule:</li>[[:space:]]*</ol>',
      responsibility_html,
      'i'
    )
  WHERE id = '984449a7-a639-435d-a364-0379bd8a4b27'
    AND (
      content LIKE '%wynikających z przepisów prawa%'
      OR content_html LIKE '%wynikających z przepisów prawa%'
    );
END $migration$;

UPDATE public.offer_products
SET recommended_contract_clauses = replace(
  recommended_contract_clauses,
  'Cena obejmuje wynajem jednego telewizora 85″ 4K na jeden dzień wydarzenia, stabilny statyw podłogowy, standardowe okablowanie zasilające i HDMI, ustawienie, konfigurację, test obrazu oraz demontaż.',
  'Liczba telewizorów 85″ 4K oraz okres najmu wynikają z zaakceptowanej oferty. Zakres obejmuje stabilny statyw podłogowy, standardowe okablowanie zasilające i HDMI, ustawienie, konfigurację, test obrazu oraz demontaż.'
)
WHERE id = '0e3f49d4-d8b1-46d2-a939-4627ed4fd559'
  AND recommended_contract_clauses LIKE '%wynajem jednego telewizora 85″ 4K na jeden dzień wydarzenia%';

UPDATE public.offer_products
SET recommended_contract_clauses = replace(
  recommended_contract_clauses,
  'Cena podstawowa obejmuje wynajem jednego totemu na jeden dzień wydarzenia, wgranie zaakceptowanych materiałów oraz standardowy montaż, uruchomienie i demontaż.',
  'Liczba totemów oraz okres najmu wynikają z zaakceptowanej oferty. Zakres obejmuje wgranie zaakceptowanych materiałów oraz standardowy montaż, uruchomienie i demontaż.'
)
WHERE id = 'b8c63b64-1ff0-44e9-ba8b-c56bafe06c07'
  AND recommended_contract_clauses LIKE '%wynajem jednego totemu na jeden dzień wydarzenia%';

UPDATE public.offer_products
SET recommended_contract_clauses = replace(
  recommended_contract_clauses,
  'Pakiet obejmuje rozmieszczenie maksymalnie 40 punktów świetlnych. Jeden punkt oznacza jedną oprawę lub jedno niezależne miejsce emisji światła. Ostateczna liczba i rozmieszczenie są dobierane do przestrzeni, bezpieczeństwa oraz uzgodnionej koncepcji; niewykorzystanie wszystkich punktów z przyczyn wynikających z warunków obiektu nie oznacza automatycznej zmiany ceny.',
  'Zakres i liczba punktów świetlnych wynikają z zaakceptowanej oferty. Jeden punkt oznacza jedną oprawę lub jedno niezależne miejsce emisji światła. Ostateczne rozmieszczenie jest dobierane do przestrzeni, zasad bezpieczeństwa oraz uzgodnionej koncepcji.'
)
WHERE id = 'bdc2b45e-d856-4c91-834a-4287a4a10989'
  AND recommended_contract_clauses LIKE '%maksymalnie 40 punktów świetlnych%';

