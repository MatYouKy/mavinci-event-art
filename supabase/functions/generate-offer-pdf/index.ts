// Compatibility endpoint for CRM tabs opened before the Node bridge rollout.
// PDF generation lives in src/lib/offer-pdf; never render PDFs in Edge.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const json = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, 'Nieobsługiwana metoda.');
  const authorization = req.headers.get('authorization');
  if (!authorization) return json(401, 'Zaloguj się ponownie.');
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  } catch {
    return json(400, 'Niepoprawne dane oferty.');
  }
  if (body.outputMode && body.outputMode !== 'crm') {
    return json(409, 'Generator został zaktualizowany. Odśwież stronę i spróbuj ponownie.');
  }
  try {
    const response = await fetch('https://mavinci.pl/bridge/offers/generate-pdf', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offerId: body.offerId,
        language: body.language,
        expectedEnglishSignature: body.expectedEnglishSignature,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(300_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...cors,
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return json(502, 'Nie udało się połączyć z generatorem PDF. Odśwież stronę i sprawdź stan oferty.');
  }
});
