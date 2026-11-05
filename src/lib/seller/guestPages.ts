/** Strony dla gościa hotelu (oferta z linku sprzedawcy, formularz z kodu QR) — bez nawigacji i stopki strony WWW. */
const GUEST_PAGE = /^\/(oferta|zapytanie)\/[a-f0-9]{24,64}\/?$/i;

export const isSellerGuestPage = (pathname: string | null | undefined) => Boolean(pathname && GUEST_PAGE.test(pathname));
