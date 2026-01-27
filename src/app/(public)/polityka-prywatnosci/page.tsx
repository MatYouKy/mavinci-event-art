import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Mail, Phone } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Polityka Prywatności - MAVINCI Event & ART',
  description: 'Polityka prywatności i ochrony danych osobowych MAVINCI Event & ART',
};

export default function PolitykaPrywatnosciPage() {
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
          Polityka Prywatności
        </h1>

        <div className="space-y-8 text-[#e5e4e2]/80">
          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">1. Informacje ogólne</h2>
            <p className="mb-4 leading-relaxed">
              Niniejsza Polityka Prywatności określa zasady przetwarzania i ochrony danych osobowych
              przekazanych przez Użytkowników w związku z korzystaniem przez nich z usług za
              pośrednictwem Serwisu mavinci.pl.
            </p>
            <p className="leading-relaxed">
              Administratorem danych osobowych jest MAVINCI Event & ART z siedzibą w Polsce.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">2. Rodzaj przetwarzanych danych</h2>
            <p className="mb-4 leading-relaxed">
              W ramach świadczonych usług przetwarzamy następujące kategorie danych osobowych:
            </p>
            <ul className="ml-6 list-disc space-y-2">
              <li>Dane identyfikacyjne (imię, nazwisko)</li>
              <li>Dane kontaktowe (adres e-mail, numer telefonu)</li>
              <li>Dane dotyczące korzystania z serwisu (adres IP, dane analityczne)</li>
              <li>Dane zawarte w zapytaniach ofertowych (rodzaj wydarzenia, lokalizacja, data)</li>
              <li>Treść korespondencji e-mail</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">3. Cel i podstawa przetwarzania danych</h2>
            <p className="mb-4 leading-relaxed">Dane osobowe przetwarzane są w następujących celach:</p>
            <ul className="ml-6 list-disc space-y-2">
              <li>
                <strong>Obsługa zapytań ofertowych</strong> - podstawa prawna: art. 6 ust. 1 lit. b RODO
                (wykonanie umowy lub podjęcie działań przed zawarciem umowy)
              </li>
              <li>
                <strong>Kontakt z klientami</strong> - podstawa prawna: art. 6 ust. 1 lit. f RODO
                (prawnie uzasadniony interes administratora)
              </li>
              <li>
                <strong>Marketing bezpośredni</strong> - podstawa prawna: art. 6 ust. 1 lit. f RODO
                (prawnie uzasadniony interes administratora) lub art. 6 ust. 1 lit. a RODO (zgoda)
              </li>
              <li>
                <strong>Analiza ruchu na stronie</strong> - podstawa prawna: art. 6 ust. 1 lit. f RODO
                (prawnie uzasadniony interes administratora)
              </li>
              <li>
                <strong>Wypełnienie obowiązków prawnych</strong> - podstawa prawna: art. 6 ust. 1 lit. c RODO
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">4. Okres przechowywania danych</h2>
            <p className="leading-relaxed">
              Dane osobowe przechowywane są przez okres niezbędny do realizacji celów, dla których zostały
              zebrane, w tym:
            </p>
            <ul className="ml-6 list-disc space-y-2">
              <li>Czas trwania umowy oraz po jej zakończeniu przez okres wymagany przepisami prawa</li>
              <li>Czas realizacji zapytania ofertowego oraz 3 lata od jego zakończenia</li>
              <li>Do czasu wycofania zgody (w przypadku przetwarzania na podstawie zgody)</li>
              <li>Do czasu wniesienia sprzeciwu (w przypadku prawnie uzasadnionego interesu)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">5. Udostępnianie danych</h2>
            <p className="mb-4 leading-relaxed">
              Dane osobowe mogą być udostępniane następującym kategoriom odbiorców:
            </p>
            <ul className="ml-6 list-disc space-y-2">
              <li>Podwykonawcom realizującym usługi na rzecz Administratora (hosting, marketing, analityka)</li>
              <li>Podmiotom świadczącym usługi płatnicze</li>
              <li>Organom uprawnionym na podstawie przepisów prawa</li>
            </ul>
            <p className="mt-4 leading-relaxed">
              Dane osobowe nie są przekazywane do państw trzecich ani organizacji międzynarodowych.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">6. Prawa osoby, której dane dotyczą</h2>
            <p className="mb-4 leading-relaxed">Użytkownik ma prawo do:</p>
            <ul className="ml-6 list-disc space-y-2">
              <li>Dostępu do swoich danych osobowych</li>
              <li>Sprostowania (poprawiania) swoich danych</li>
              <li>Usunięcia danych (prawo do bycia zapomnianym)</li>
              <li>Ograniczenia przetwarzania danych</li>
              <li>Przenoszenia danych</li>
              <li>Wniesienia sprzeciwu wobec przetwarzania</li>
              <li>Wycofania zgody w dowolnym momencie (jeśli przetwarzanie odbywa się na podstawie zgody)</li>
              <li>Wniesienia skargi do organu nadzorczego (Prezes Urzędu Ochrony Danych Osobowych)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">7. Pliki cookies i technologie śledzące</h2>
            <p className="mb-4 leading-relaxed">
              Serwis wykorzystuje pliki cookies i podobne technologie w celu:
            </p>
            <ul className="ml-6 list-disc space-y-2">
              <li>Zapewnienia prawidłowego funkcjonowania strony</li>
              <li>Dostosowania zawartości do preferencji użytkownika</li>
              <li>Analizy ruchu na stronie (Google Analytics)</li>
              <li>Obsługi reklam i kampanii marketingowych</li>
            </ul>
            <p className="mt-4 leading-relaxed">
              Użytkownik może w każdej chwili zmienić ustawienia dotyczące plików cookies w swojej
              przeglądarce.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">8. Bezpieczeństwo danych</h2>
            <p className="leading-relaxed">
              Administrator stosuje odpowiednie środki techniczne i organizacyjne zapewniające ochronę
              przetwarzanych danych osobowych, w tym zabezpieczenia przed nieuprawnionym dostępem, utratą,
              zniszczeniem lub modyfikacją danych.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">9. Zmiany w Polityce Prywatności</h2>
            <p className="leading-relaxed">
              Administrator zastrzega sobie prawo do wprowadzania zmian w niniejszej Polityce Prywatności.
              O wszelkich zmianach użytkownicy zostaną poinformowani poprzez publikację nowej wersji na
              stronie internetowej.
            </p>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-light text-[#e5e4e2]">10. Kontakt</h2>
            <p className="leading-relaxed">
              W sprawach związanych z ochroną danych osobowych można kontaktować się z Administratorem:
            </p>
            <ul className="ml-6 mt-4 list-disc space-y-2">
              <li><Mail className="h-4 w-4" /> E-mail: biuro@mavinci.pl</li>
              <li><Phone className="h-4 w-4" /> Telefon: +48 698 212 279</li>
            </ul>
          </section>

          <div className="mt-12 border-t border-[#d3bb73]/20 pt-6">
            <p className="text-sm text-[#e5e4e2]/60">
              Data ostatniej aktualizacji: {new Date().toLocaleDateString('pl-PL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
