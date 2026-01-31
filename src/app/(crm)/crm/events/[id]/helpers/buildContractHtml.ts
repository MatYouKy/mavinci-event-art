export const buildContractHtml = ({
  pagesHtml,
  cssText,
  baseUrl,
  title = 'Umowa',
}: {
  pagesHtml: string;
  cssText: string;
  baseUrl: string;
  title?: string;
}) => {
  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <base href="${baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${cssText}</style>
</head>
<body>
  <div class="contract-a4-container">
    ${pagesHtml}
  </div>
</body>
</html>`;
};