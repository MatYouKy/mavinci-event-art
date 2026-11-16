/* eslint-disable @next/next/no-img-element */
import { contractFooterLogoSrc, contractLogoSrc } from '@/lib/CRM/contracts/contractPagination';

/*
 * Strony umowy wydarzenia jak w podglądzie zakładki „Umowa” (`EventContractTab`): logo i data na pierwszej stronie, treść
 * strony, stopka i licznik stron. Wydzielone bez zmian, żeby ten sam znacznik (zawartość `.contract-a4-container`) trafiał
 * do PDF z CRM i z silnika dokumentów na Macu (`/native-engine/contracts`).
 */
export function ContractPagesView({ contractContent }: { contractContent: string }) {
  return (
    <>
      {(() => {
        try {
          const parsed = JSON.parse(contractContent);
          const pages = parsed.pages || (Array.isArray(parsed) ? parsed : null);
          const settings = parsed.settings || {
            logoScale: 80,
            logoPositionX: 50,
            logoPositionY: 0,
            lineHeight: 1.6,
            selectedLogo: '/erulers_logo_vect.png',
            selectedFooter: 'default',
            footerContent: {
              companyName: 'EVENT RULERS',
              tagline: 'Więcej niż Wodzireje!',
              website: 'www.eventrulers.pl',
              email: 'biuro@eventrulers.pl',
              phone: '698-212-279',
              logoUrl: '/erulers_logo_vect.png',
            },
            footerLogoScale: 80,
          };

          if (pages && Array.isArray(pages)) {
            return pages.map((pageContent: string, pageIndex: number) => (
              <div key={pageIndex} className="contract-a4-page">
                {pageIndex === 0 && (
                  <>
                    <div
                      className={`contract-header-logo ${
                        settings.logoPositionX <= 33
                          ? 'justify-start'
                          : settings.logoPositionX >= 67
                            ? 'justify-end'
                            : 'justify-center'
                      }`}
                      style={{
                        marginTop: `${settings.logoPositionY}mm`,
                      }}
                    >
                      {contractLogoSrc(settings.selectedLogo) && (
                        <img
                          src={contractLogoSrc(settings.selectedLogo)!}
                          alt="Logo"
                          style={{
                            maxWidth: `${settings.logoScale}%`,
                            height: 'auto',
                          }}
                        />
                      )}
                    </div>

                    <div className="contract-current-date">
                      Olsztyn,{' '}
                      {new Date().toLocaleDateString('pl-PL', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </div>
                  </>
                )}

                <div
                  className="contract-content"
                  style={{
                    lineHeight: String(settings.lineHeight),
                    fontFamily: settings.selectedFont || 'Georgia, serif',
                    minHeight: 0,
                    flex: '1 1 0',
                    overflow: 'hidden',
                  }}
                  dangerouslySetInnerHTML={{ __html: pageContent }}
                />

                {settings.selectedFooter !== 'none' && (
                  <div
                    className="contract-footer"
                    style={{ fontFamily: settings.selectedFont || 'Georgia, serif' }}
                  >
                    {settings.selectedFooter === 'default' && contractFooterLogoSrc(settings) && (
                      <div className="footer-logo">
                        <img
                          src={contractFooterLogoSrc(settings)!}
                          alt="Logo"
                          style={{
                            maxWidth: `${settings.footerLogoScale || 80}%`,
                            height: 'auto',
                          }}
                        />
                      </div>
                    )}
                    <div className="footer-info">
                      <p>
                        <span className="font-bold">
                          {settings.footerContent?.companyName ?? 'EVENT RULERS'}
                        </span>
                        {settings.footerContent?.tagline && (
                          <>
                            {' '}
                            – <span className="italic">{settings.footerContent.tagline}</span>
                          </>
                        )}
                      </p>
                      <p>
                        {[
                          settings.footerContent?.website ?? 'www.eventrulers.pl',
                          settings.footerContent?.email ?? 'biuro@eventrulers.pl',
                        ].filter(Boolean).join(' | ')}
                      </p>
                      {settings.footerContent?.phone !== '' && (
                        <p>tel: {settings.footerContent?.phone ?? '698-212-279'}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="contract-page-counter">
                  {pageIndex + 1}/{pages.length}
                </div>
              </div>
            ));
          }
        } catch (e) {
          // Fallback dla starych szablonów - spróbuj wyciągnąć logo z parsed settings jeśli istnieje
          let fallbackLogoUrl = 'https://mavinci.pl/erulers_logo_vect.png';
          try {
            const parsed = JSON.parse(contractContent);
            const logoUrl = parsed?.settings?.selectedLogo || parsed?.selectedLogo;
            if (logoUrl?.startsWith('http')) {
              fallbackLogoUrl = logoUrl;
            }
          } catch {
            // Użyj domyślnego URL
          }

          return (
            <div className="contract-a4-page">
              <div className="contract-header-logo">
                <img src={fallbackLogoUrl} alt="EVENT RULERS" />
              </div>

              <div className="contract-current-date">
                Olsztyn,{' '}
                {new Date().toLocaleDateString('pl-PL', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>

              <div
                className="contract-content"
                dangerouslySetInnerHTML={{ __html: contractContent }}
              />

              <div className="contract-footer">
                <div className="footer-logo">
                  <img src={fallbackLogoUrl} alt="EVENT RULERS" />
                </div>
                <div className="footer-info">
                  <p>
                    <strong>EVENT RULERS</strong> – <em>Więcej niż Wodzireje!</em>
                  </p>
                  <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                  <p>tel: 698-212-279</p>
                </div>
              </div>
            </div>
          );
        }
      })()}
    </>
  );
}
