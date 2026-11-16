import type { Metadata } from 'next';
import '@/index.css';
import '@/styles/crm-themes.css';

/*
 * Strony silnika dokumentów dla aplikacji na Maca: Mac wczytuje je w lokalnym Chrome (bez okna, DevTools Protocol, jak
 * wydruki `LocalPdfEngine`) i uruchamia w nich te same funkcje dokumentów co CRM w przeglądarce (podział umowy na strony,
 * przekształcenie szablonu, scalanie szablonów). Strony nie pobierają danych — dostają je od Maca i oddają wynik.
 * Te same style globalne co CRM, żeby pomiary układu były identyczne.
 */
export const metadata: Metadata = {
  title: 'Mavinci — silnik dokumentów',
  robots: { index: false, follow: false },
};

export default function EngineLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
