import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { deleteOffer, deleteOfferPdf, offerDetail, offerEnglish, offerPdf, offersAccess, offersState, setOfferStatus } from '@/lib/native/offers';
import {
  deleteOfferItem,
  draftOfferAssumptions,
  offerAssumptionsEditor,
  offerCalculations,
  offerEditor,
  organizationContacts,
  reorderOfferItems,
  saveOfferAssumptions,
  saveOfferBasic,
  saveOfferDiscount,
  updateOfferItemPresentation,
} from '@/lib/native/offerEdit';
import {
  addOfferItem,
  offerItemCatalog,
  offerItemEditor,
  previewOfferItem,
  saveOfferAudience,
  updateOfferItem,
} from '@/lib/native/offerItems';
import { offerPackages, offerRequirements, saveOfferPackages, saveOfferRequirements } from '@/lib/native/offerSections';
import {
  createOfferEvent,
  linkOffer,
  offerDraftRevision,
  offerEmailPreview,
  offerEmailSetup,
  offerEventSetup,
  offerLinkChoices,
  redactOfferEmail,
  sendOfferEmail,
} from '@/lib/native/offerActions';
import {
  buildOfferRecommendation,
  offerRecommendations,
  previewOfferRecommendation,
  saveOfferRecommendations,
} from '@/lib/native/offerRecommendations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Propozycja założeń z AI trwa do około minuty, tłumaczenie oferty na angielski — do 3 minut.
export const maxDuration = 300;

/*
 * Oferty dla aplikacji na Maca (`src/lib/native/offers.ts`): GET op=state (lista ofert do kopii na dysku), op=offer&id=… (strona
 * oferty), op=pdf&id=… (podpisany adres zapisanego PDF), op=editor&id=… (dane do edycji informacji podstawowych),
 * op=contacts&organization=… (osoby kontaktowe organizacji), op=calculations&id=…&event=… (kalkulacje), op=assumptions&id=…;
 * POST op=status (szkic, wysłana, odrzucona, wygasła) | delete | basicSave | assumptionsSave | assumptionsAI | discountSave |
 * itemsReorder | itemPresentation (układ w PDF, warianty) | itemDelete (`src/lib/native/offerEdit.ts`);
 * pozycje (`src/lib/native/offerItems.ts`): GET op=itemCatalog&id=… | itemEditor&id=…&item=…; POST op=itemPreview (wycena
 * szkicu) | itemAdd | itemUpdate | audienceSave (liczba osób i stołów do wyceny);
 * wymagania, pakiety i logistyka (`src/lib/native/offerSections.ts`): GET op=requirements&id=… | packages&id=…;
 * POST op=requirementsSave | packagesSave; propozycje dodatkowe (`src/lib/native/offerRecommendations.ts`): GET
 * op=recommendations&id=… (katalog do propozycji: op=itemCatalog&mode=recommendation&exclude=…); POST op=recommendationBuild |
 * recommendationPreview | recommendationsSave; dokumenty: GET op=pdf&id=…&language=pl|en; POST op=pdfDelete | english (angielska
 * treść oferty, `translate-offer`). Sam PDF generuje `/bridge/offers/generate-pdf` (postęp w strumieniu, jak w CRM).
 * Czynności (`src/lib/native/offerActions.ts`): GET op=emailSetup&id=… | linkChoices&id=…&kind=event|inquiry&search=… |
 * eventSetup&id=…; POST op=emailPreview | emailAI | emailSend | link | draftRevision | eventCreate.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!offersAccess(ctx).canView) return failure('Nie masz dostępu do ofert.', 403);
  const url = new URL(request.url);
  try {
    switch (url.searchParams.get('op')) {
      case 'state': return nativeJson(await offersState(ctx));
      case 'offer': return nativeJson(await offerDetail(ctx, url.searchParams.get('id') || ''));
      case 'pdf': return nativeJson(await offerPdf(ctx, url.searchParams.get('id') || '', url.searchParams.get('language')));
      case 'editor': return nativeJson(await offerEditor(ctx, url.searchParams.get('id') || ''));
      case 'contacts': return nativeJson(await organizationContacts(ctx, url.searchParams.get('organization') || ''));
      case 'calculations': return nativeJson(await offerCalculations(ctx, url.searchParams.get('id') || '', url.searchParams.get('event')));
      case 'assumptions': return nativeJson(await offerAssumptionsEditor(ctx, url.searchParams.get('id') || ''));
      case 'itemCatalog': {
        const exclude = url.searchParams.get('mode') === 'recommendation'
          ? (url.searchParams.get('exclude') || '').split(',').filter(Boolean).slice(0, 200)
          : null;
        return nativeJson(await offerItemCatalog(ctx, url.searchParams.get('id') || '', exclude));
      }
      case 'itemEditor': return nativeJson(await offerItemEditor(ctx, url.searchParams.get('id') || '', url.searchParams.get('item') || ''));
      case 'requirements': return nativeJson(await offerRequirements(ctx, url.searchParams.get('id') || ''));
      case 'packages': return nativeJson(await offerPackages(ctx, url.searchParams.get('id') || ''));
      case 'recommendations': return nativeJson(await offerRecommendations(ctx, url.searchParams.get('id') || ''));
      case 'emailSetup': return nativeJson(await offerEmailSetup(ctx, url.searchParams.get('id') || ''));
      case 'linkChoices': return nativeJson(await offerLinkChoices(ctx, url.searchParams.get('id') || '', url.searchParams.get('kind') || 'event', url.searchParams.get('search') || ''));
      case 'eventSetup': return nativeJson(await offerEventSetup(ctx, url.searchParams.get('id') || ''));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać ofert.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!offersAccess(ctx).canView) return failure('Nie masz dostępu do ofert.', 403);
  let body: Record<string, any>;
  try {
    // Grafika hero oferty (do 12 MB w base64); pozostałe operacje to krótkie formularze.
    body = await readJson(request, 18_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'status': return nativeJson(await setOfferStatus(ctx, body));
      case 'delete': return nativeJson(await deleteOffer(ctx, body));
      case 'pdfDelete': return nativeJson(await deleteOfferPdf(ctx, body));
      case 'english': return nativeJson(await offerEnglish(ctx, body));
      case 'basicSave': return nativeJson(await saveOfferBasic(ctx, body));
      case 'assumptionsSave': return nativeJson(await saveOfferAssumptions(ctx, body));
      case 'assumptionsAI': return nativeJson(await draftOfferAssumptions(ctx, body));
      case 'discountSave': return nativeJson(await saveOfferDiscount(ctx, body));
      case 'itemsReorder': return nativeJson(await reorderOfferItems(ctx, body));
      case 'itemPresentation': return nativeJson(await updateOfferItemPresentation(ctx, body));
      case 'itemDelete': return nativeJson(await deleteOfferItem(ctx, body));
      case 'itemPreview': return nativeJson(await previewOfferItem(ctx, body));
      case 'itemAdd': return nativeJson(await addOfferItem(ctx, body));
      case 'itemUpdate': return nativeJson(await updateOfferItem(ctx, body));
      case 'audienceSave': return nativeJson(await saveOfferAudience(ctx, body));
      case 'requirementsSave': return nativeJson(await saveOfferRequirements(ctx, body));
      case 'packagesSave': return nativeJson(await saveOfferPackages(ctx, body));
      case 'recommendationBuild': return nativeJson(await buildOfferRecommendation(ctx, body));
      case 'recommendationPreview': return nativeJson(await previewOfferRecommendation(ctx, body));
      case 'recommendationsSave': return nativeJson(await saveOfferRecommendations(ctx, body));
      case 'emailPreview': return nativeJson(await offerEmailPreview(ctx, body));
      case 'emailAI': return nativeJson(await redactOfferEmail(ctx, body));
      case 'emailSend': {
        // Wysyłka idzie do funkcji poczty tokenem pracownika (jak `dispatchCrmEmail` w przeglądarce).
        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
        return nativeJson(await sendOfferEmail(ctx, body, token));
      }
      case 'link': return nativeJson(await linkOffer(ctx, body));
      case 'draftRevision': return nativeJson(await offerDraftRevision(ctx, body));
      case 'eventCreate': return nativeJson(await createOfferEvent(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
