import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Mail, Phone } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Regulamin usług i aplikacji CRM - MAVINCI Event & ART',
  description:
    'Regulamin świadczenia usług oraz korzystania z aplikacji CRM i integracji Google Ads, Google Search Console i Meta przez MAVINCI Event & ART.',
};

export default function RegulaminPage() {
  return (
    <div className="min-h-screen bg-[#0f1119]">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrót do strony głównej
        </Link>

        <h1 className="mb-8 text-4xl font-light text-[#e5e4e2] md:text-5xl">
          Regulamin świadczenia usług i korzystania z aplikacji
        </h1>

        <div className="space-y-8 text-[#e5e4e2]/80">
          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 1. Postanowienia ogólne</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Niniejszy Regulamin określa zasady świadczenia usług w zakresie organizacji i
                obsługi technicznej wydarzeń przez MAVINCI Event & ART, zwaną dalej
                &quot;Usługodawcą&quot;, a także zasady korzystania z udostępnianej przez
                Usługodawcę aplikacji CRM i jej integracji z usługami zewnętrznymi.
              </li>
              <li>
                Usługodawca prowadzi działalność gospodarczą na terenie Polski w zakresie:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>
                    Obsługi technicznej eventów (nagłośnienie, oświetlenie, technika sceniczna)
                  </li>
                  <li>Usług DJ i prowadzenia imprez</li>
                  <li>Streamingu i nagrywania wydarzeń</li>
                  <li>Dostarczania atrakcji eventowych</li>
                  <li>Organizacji konferencji i szkoleń</li>
                </ul>
              </li>
              <li>
                Regulamin stanowi integralną część umowy zawieranej między Usługodawcą a Klientem.
              </li>
              <li>
                Akceptacja Regulaminu następuje poprzez złożenie zamówienia lub podpisanie umowy.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 2. Definicje</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                <strong>Usługodawca</strong> - MAVINCI Event & ART
              </li>
              <li>
                <strong>Klient</strong> - osoba fizyczna, prawna lub jednostka organizacyjna
                zamawiająca usługi
              </li>
              <li>
                <strong>Umowa</strong> - umowa o świadczenie usług zawarta między Usługodawcą a
                Klientem
              </li>
              <li>
                <strong>Oferta</strong> - wycena przesłana Klientowi zawierająca zakres usług i cenę
              </li>
              <li>
                <strong>Wydarzenie</strong> - impreza, konferencja, szkolenie lub inne wydarzenie
                objęte umową
              </li>
              <li>
                <strong>Aplikacja CRM</strong> - system informatyczny dostępny w domenie mavinci.pl,
                służący Usługodawcy między innymi do obsługi klientów, wydarzeń, dokumentów i
                działań marketingowych
              </li>
              <li>
                <strong>Użytkownik CRM</strong> - pracownik, współpracownik albo inna osoba, której
                Usługodawca nadał dostęp do Aplikacji CRM
              </li>
              <li>
                <strong>Integracja</strong> - opcjonalne połączenie Aplikacji CRM z usługą
                zewnętrzną, w szczególności Google Ads, Google Search Console lub Meta/Facebook
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 3. Zakres usług</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>Usługodawca świadczy usługi zgodnie z umową i zaakceptowaną ofertą.</li>
              <li>
                Szczegółowy zakres usług, termin realizacji, miejsce wydarzenia i wynagrodzenie
                określa umowa.
              </li>
              <li>
                Usługodawca zobowiązuje się do świadczenia usług z należytą starannością, zgodnie z
                profesjonalnymi standardami branżowymi.
              </li>
              <li>Usługi świadczone są przez wykwalifikowany personel techniczny i artystyczny.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">
              § 4. Proces składania zamówień
            </h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Klient składa zapytanie ofertowe poprzez formularz na stronie, e-mail lub
                telefonicznie.
              </li>
              <li>
                Usługodawca przygotowuje ofertę w terminie do 48 godzin od otrzymania zapytania.
              </li>
              <li>
                Oferta jest ważna przez 14 dni od daty wystawienia, chyba że wskazano inaczej.
              </li>
              <li>
                Akceptacja oferty następuje poprzez:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Pisemne potwierdzenie (e-mail, podpisana umowa)</li>
                  <li>Wpłatę zadatku w wysokości określonej w ofercie</li>
                </ul>
              </li>
              <li>
                Po akceptacji oferty strony zawierają umowę, która precyzuje warunki realizacji
                usługi.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 5. Ceny i płatności</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Ceny usług określone są w ofercie i zawierają podatek VAT, chyba że wskazano
                inaczej.
              </li>
              <li>
                Klient zobowiązany jest do wpłaty zadatku w wysokości 30-50% wartości zamówienia
                (określonego w ofercie) w terminie 7 dni od akceptacji oferty.
              </li>
              <li>
                Pozostała część wynagrodzenia płatna jest:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Najpóźniej na 3 dni przed wydarzeniem - w przypadku przelewu</li>
                  <li>Bezpośrednio po zakończeniu wydarzenia - w przypadku płatności gotówką</li>
                </ul>
              </li>
              <li>Brak wpłaty zadatku w terminie powoduje anulowanie rezerwacji.</li>
              <li>Za opóźnienie w płatności przysługują odsetki ustawowe.</li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">
              § 6. Zmiana i anulowanie zamówienia
            </h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Klient może zmienić zakres usług do 14 dni przed wydarzeniem. Zmiany mogą wpłynąć na
                cenę.
              </li>
              <li>
                Rezygnacja z usług:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Powyżej 30 dni przed wydarzeniem - zwrot 80% zadatku</li>
                  <li>15-30 dni przed wydarzeniem - zwrot 50% zadatku</li>
                  <li>Poniżej 15 dni przed wydarzeniem - brak zwrotu zadatku</li>
                </ul>
              </li>
              <li>
                W przypadku siły wyższej (np. pandemia, klęska żywiołowa) strony ustalają nowy
                termin lub dokonują zwrotu 100% wpłaconych środków.
              </li>
              <li>
                Usługodawca zastrzega sobie prawo do odstąpienia od umowy w przypadku braku
                płatności lub naruszenia postanowień regulaminu przez Klienta.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 7. Obowiązki Klienta</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Klient zobowiązany jest do:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Przekazania pełnych i prawdziwych informacji o wydarzeniu</li>
                  <li>Zapewnienia dostępu do miejsca wydarzenia w uzgodnionym terminie</li>
                  <li>Zapewnienia podstawowych warunków (prąd, parking, zaplecze)</li>
                  <li>Terminowej płatności</li>
                  <li>Poinformowania o zmianach w harmonogramie wydarzenia</li>
                </ul>
              </li>
              <li>
                Klient ponosi odpowiedzialność za bezpieczeństwo uczestników wydarzenia oraz za
                uzyskanie niezbędnych pozwoleń i zgód.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 8. Odpowiedzialność</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Usługodawca nie ponosi odpowiedzialności za:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Szkody wynikające z nieprawidłowych informacji przekazanych przez Klienta</li>
                  <li>Szkody spowodowane siłą wyższą</li>
                  <li>Opóźnienia wynikające z braku dostępu do miejsca wydarzenia</li>
                  <li>Działania osób trzecich</li>
                </ul>
              </li>
              <li>
                Odpowiedzialność Usługodawcy ograniczona jest do wysokości wynagrodzenia za dane
                zamówienie.
              </li>
              <li>
                Klient ponosi odpowiedzialność za szkody wyrządzone w wynajętym sprzęcie w pełnej
                wysokości.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">
              § 9. Prawa autorskie i wizerunek
            </h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Materiały wideo i foto z wydarzenia są własnością Usługodawcy, chyba że umowa
                stanowi inaczej.
              </li>
              <li>
                Usługodawca ma prawo wykorzystywać materiały z wydarzeń w celach marketingowych,
                chyba że Klient wyraźnie się temu sprzeciwi.
              </li>
              <li>
                Klient zobowiązuje się uzyskać zgodę uczestników na rejestrację audio-wideo
                wydarzenia.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 10. Reklamacje</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Reklamacje można składać w formie pisemnej (e-mail, list) w terminie 7 dni od
                wydarzenia.
              </li>
              <li>
                Reklamacja powinna zawierać:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Dane Klienta</li>
                  <li>Numer umowy lub zamówienia</li>
                  <li>Opis problemu</li>
                  <li>Oczekiwania Klienta</li>
                </ul>
              </li>
              <li>
                Usługodawca rozpatruje reklamację w terminie 14 dni i informuje Klienta o decyzji.
              </li>
              <li>
                W przypadku uzasadnionej reklamacji Usługodawca może zaproponować:
                <ul className="ml-6 mt-2 list-disc space-y-1">
                  <li>Obniżenie ceny</li>
                  <li>Powtórzenie usługi</li>
                  <li>Zwrot części wynagrodzenia</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">
              § 11. Ochrona danych osobowych
            </h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Usługodawca przetwarza dane osobowe zgodnie z RODO i{' '}
                <Link
                  href="/polityka-prywatnosci"
                  className="text-[#d3bb73] underline decoration-[#d3bb73]/40 underline-offset-4 hover:text-[#d3bb73]/80"
                >
                  Polityką Prywatności
                </Link>
                .
              </li>
              <li>
                Dane osobowe wykorzystywane są wyłącznie w celach realizacji umowy i marketingu (za
                zgodą).
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">
              § 12. Aplikacja CRM i integracje zewnętrzne
            </h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                Aplikacja CRM jest narzędziem przeznaczonym dla osób upoważnionych przez
                Usługodawcę. Użytkownik CRM jest zobowiązany chronić dane logowania, nie udostępniać
                konta osobom trzecim i niezwłocznie zgłaszać podejrzenie nieuprawnionego dostępu.
              </li>
              <li>
                Połączenie Aplikacji CRM z Google Ads, Google Search Console lub Meta/Facebook jest
                dobrowolne. Integracja jest uruchamiana dopiero po zalogowaniu się przez Użytkownika
                CRM do właściwej usługi i zaakceptowaniu zakresu uprawnień przedstawionego na
                ekranie autoryzacji tej usługi.
              </li>
              <li>
                Użytkownik CRM może połączyć wyłącznie konto, stronę, usługę lub konto reklamowe,
                do których posiada wymagane uprawnienia. Użytkownik odpowiada za prawidłowość
                wskazanych identyfikatorów oraz zgodność korzystania z Integracji z prawem i
                regulaminem dostawcy zewnętrznego.
              </li>
              <li>
                W ramach Integracji Google Aplikacja CRM może pobierać podstawowe dane profilu
                konta Google, dane o skuteczności kampanii Google Ads oraz dane o widoczności
                zweryfikowanych usług w Google Search Console. Obejmuje to w szczególności nazwy i
                statusy kampanii, budżety, wyświetlenia, kliknięcia, koszty, konwersje, wartość
                konwersji, organiczne kliknięcia i wyświetlenia, współczynnik klikalności oraz
                średnią pozycję w wynikach wyszukiwania.
              </li>
              <li>
                W ramach Integracji Meta/Facebook Aplikacja CRM może pobierać listę stron i kont
                reklamowych dostępnych dla Użytkownika CRM, statystyki stron i kampanii, informacje
                o kampaniach oraz wiadomości kierowane do połączonej strony, w zakresie udzielonych
                uprawnień.
              </li>
              <li>
                Dane z Integracji są wykorzystywane wyłącznie do prezentowania raportów i
                statystyk, synchronizacji danych marketingowych, obsługi wiadomości oraz realizacji
                funkcji widocznych w Aplikacji CRM. Jeżeli Użytkownik CRM wyda takie polecenie,
                Aplikacja CRM może również włączyć lub wstrzymać wskazaną kampanię Google Ads albo
                Meta Ads.
              </li>
              <li>
                Usługodawca nie sprzedaje danych uzyskanych przez interfejsy Google ani Meta, nie
                wykorzystuje ich do tworzenia niezależnych profili reklamowych i nie używa ich do
                celów niezwiązanych z funkcjami Aplikacji CRM. Dostęp do tych danych mają wyłącznie
                upoważnione osoby i niezbędni dostawcy infrastruktury działający na rzecz
                Usługodawcy, z zastrzeżeniem obowiązków wynikających z przepisów prawa.
              </li>
              <li>
                Dane uwierzytelniające i tokeny dostępu są przechowywane w postaci zaszyfrowanej.
                Usługodawca stosuje środki organizacyjne i techniczne odpowiednie do charakteru
                przetwarzanych danych, jednak żaden system teleinformatyczny nie gwarantuje pełnej
                niezawodności ani nieprzerwanej dostępności.
              </li>
              <li>
                Integrację można odłączyć w Aplikacji CRM, a zgodę można dodatkowo wycofać w
                ustawieniach konta Google lub Meta/Facebook. Odłączenie zatrzymuje przyszły dostęp
                przez daną Integrację. Dane zapisane przed odłączeniem są przechowywane lub usuwane
                zgodnie z Polityką Prywatności, obowiązującymi terminami retencji i przepisami prawa.
              </li>
              <li>
                Dostępność i zakres działania Integracji zależą również od dostawców zewnętrznych.
                Zmiana ich interfejsów, regulaminów, zakresów uprawnień, limitów albo dostępności
                może czasowo ograniczyć lub wyłączyć część funkcji Aplikacji CRM.
              </li>
              <li>
                Korzystanie z Integracji Google podlega również{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#d3bb73] underline decoration-[#d3bb73]/40 underline-offset-4 hover:text-[#d3bb73]/80"
                >
                  zasadom dotyczącym danych użytkowników usług Google API
                </a>{' '}
                oraz, w przypadku Google Ads,{' '}
                <a
                  href="https://developers.google.com/google-ads/api/docs/api-policy/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#d3bb73] underline decoration-[#d3bb73]/40 underline-offset-4 hover:text-[#d3bb73]/80"
                >
                  warunkom korzystania z Google Ads API
                </a>
                . Szczegółowe informacje o dostępie, wykorzystywaniu, przechowywaniu i udostępnianiu
                danych zawiera Polityka Prywatności.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 13. Postanowienia końcowe</h2>
            <ol className="ml-6 list-decimal space-y-3">
              <li>
                W sprawach nieuregulowanych w Regulaminie mają zastosowanie przepisy Kodeksu
                Cywilnego.
              </li>
              <li>
                Spory rozstrzygane będą polubownie, a w przypadku braku porozumienia przez sąd
                właściwy dla siedziby Usługodawcy.
              </li>
              <li>Regulamin wchodzi w życie z dniem publikacji na stronie internetowej.</li>
              <li>
                Usługodawca zastrzega sobie prawo do wprowadzania zmian w Regulaminie. Zmiany nie
                dotyczą umów zawartych przed datą zmiany.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">§ 14. Kontakt</h2>
            <p className="leading-relaxed">
              W sprawach związanych z Regulaminem można kontaktować się z Usługodawcą:
            </p>
            <ul className="ml-6 mt-4 list-disc space-y-2">
              <li>
                <Mail className="h-4 w-4" /> E-mail: biuro@mavinci.pl
              </li>
              <li>
                <Phone className="h-4 w-4" /> Telefon: +48 698 212 279
              </li>
              <li>
                <Link href="/kontakt" className="text-[#d3bb73] hover:text-[#d3bb73]/80">
                  Formularz kontaktowy na stronie mavinci.pl
                </Link>{' '}
                <ArrowRight className="h-4 w-4" />
              </li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#d3bb73]/20 pt-6">
            <p className="text-sm text-[#e5e4e2]/60">
              Data wejścia w życie: 1 września 2026 r.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
