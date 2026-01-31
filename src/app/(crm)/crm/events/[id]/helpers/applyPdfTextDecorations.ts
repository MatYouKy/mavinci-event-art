export function applyPdfTextDecorations(root: HTMLElement) {
  // LINE-THROUGH: zamiast text-decoration (buguje w canvas) -> background gradient w połowie tekstu
  const strikeEls = root.querySelectorAll<HTMLElement>('s, strike, del');
  strikeEls.forEach((el) => {
    el.style.textDecoration = 'none';
    el.style.backgroundImage = 'linear-gradient(currentColor,currentColor)';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = '100% 2px';
    el.style.backgroundPosition = '0 55%';
  });

  // UNDERLINE: jeżeli masz <u> i w PDF robi “losową linię”, to też lepiej backgroundem
  const underlineEls = root.querySelectorAll<HTMLElement>('u');
  underlineEls.forEach((el) => {
    el.style.textDecoration = 'none';
    el.style.backgroundImage = 'linear-gradient(currentColor,currentColor)';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = '100% 2px';
    el.style.backgroundPosition = '0 100%';
  });
}

export function applyPdfPageTweaks(root: HTMLElement) {
  const pages = root.querySelectorAll<HTMLElement>('.contract-a4-page');
  pages.forEach((p) => {
    p.style.marginBottom = '0';
    p.style.boxShadow = 'none';

    // KLUCZ: nie height, tylko auto + minHeight
    p.style.height = 'auto';
    p.style.minHeight = '297mm';
    p.style.boxSizing = 'border-box';

    p.style.pageBreakAfter = 'always';
    p.style.breakAfter = 'page';
  });

  const last = pages[pages.length - 1];
  if (last) {
    last.style.pageBreakAfter = 'auto';
    last.style.breakAfter = 'auto';
  }
}