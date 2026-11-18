import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { sellerCard, sellersCockpit, sellersHelp } from '@/lib/native/sellers';
import { decideSellerOfferPrice, sellerOfferReview } from '@/lib/native/sellerOffer';
import { createSeller, newSellerOrganizations, newSellerPeople, newSellerSetup, validateNewSeller } from '@/lib/native/sellerCreate';
import {
  approveCommission, commissionAccount, commissionPayroll, deductCommission, payoutCommission, type CommissionReply,
} from '@/lib/native/teamCommissions';
import {
  openSellerConversation, readSellerChat, sellerAudit, sellerChatMessages, sellerConversations, sendSellerChatMessage,
} from '@/lib/native/sellerChat';
import {
  assignSellerManager, saveSellerSettings, sellerManagement, sellerSettings, setSellerCommissionVisibility, validateSellerSettings,
} from '@/lib/native/sellerSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Sprzedawcy zewnętrzni dla aplikacji na Maca (`src/lib/native/sellers.ts`): GET op=cockpit&manager=… (kokpit opiekuna: „Dziś”,
 * oś w 5 etapach, sprzedawcy, wydarzenia, ostrzeżenia) | seller&id=… (karta: „Gotowość do pracy”, oferty na osi, realizacje,
 * marki) | help (instrukcja opiekuna z `src/lib/help/managerHelp.ts`); POST op=inquiryRespond {id, status, response} |
 * inquiryConvert {id} — zapytania klientów od sprzedawców (`respond_seller_inquiry`, `convert_seller_inquiry`), jak w CRM.
 * Ocena oferty z portalu (`src/lib/native/sellerOffer.ts`): GET op=offer&id=… (stan jak w CRM, zgoda na cenę, oś, warunki decyzji);
 * POST op=priceDecide {id, decision approved|changes_requested, note, expectedKey}. Decyzję oceny, PDF i analizę sprzętu
 * aplikacja wysyła na `/bridge/seller/offers/[id]` — tę samą trasę co CRM.
 * Kreator „Nowy sprzedawca” (`src/lib/native/sellerCreate.ts`): GET op=newSeller | people&source=contact|employee&q=… |
 * organizations&q=…; POST op=validate {form} (braki i wskazówki) | create {form} (profil, warunki marek, opiekun, zaproszenie).
 * Ponowne zaproszenie do portalu: `/bridge/seller/invite` (token pracownika, jak w CRM). Dostęp rozstrzyga baza.
 * Konto prowizji i narzutów sprzedawcy (`src/lib/native/teamCommissions.ts`, konto `partner`): GET op=commissions&id=…;
 * POST op=commissionApprove | commissionPayout | commissionDeduct | commissionPayroll {id: sprzedawca, …} — jak na karcie pracownika.
 * Rozmowy ze sprzedawcą i historia zmian (`src/lib/native/sellerChat.ts`): GET op=conversations&id=… (sprzedawca) |
 * messages&id=…&before=… (rozmowa) | audit&id=…&limit=…; POST op=chatOpen {id: sprzedawca, companyId, offerId?} |
 * chatSend {id: rozmowa, messageId, body} | chatRead {id: rozmowa, through}.
 * Ustawienia sprzedawcy (`src/lib/native/sellerSettings.ts`): GET op=management&id=… (opiekun, zastępca, marki i widoczność
 * wynagrodzenia) | settings&id=… (profil do edycji); POST op=manager {id, managerId, backupId, reason} | visibility {id, companyId,
 * visible, reason, notify} | settingsValidate {id, form} (braki) | settingsSave {id, form} (profil, warunki marek, zaproszenie).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const reply = (result: CommissionReply<unknown>) => (result.ok ? nativeJson(result.data) : failure(result.error, result.status));
const statusOf = (error: unknown) => {
  const value = error as { status?: number; code?: string } | null;
  if (value?.status) return value.status;
  return value?.code === '42501' ? 403 : value?.code ? 400 : 500;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  try {
    switch (op) {
      case 'cockpit': {
        const manager = url.searchParams.get('manager') || '';
        return nativeJson(await sellersCockpit(ctx, uuid.test(manager) ? manager : null));
      }
      case 'seller': {
        const id = url.searchParams.get('id') || '';
        if (!uuid.test(id)) return failure('Nieprawidłowy sprzedawca.');
        return nativeJson(await sellerCard(ctx, id));
      }
      case 'help':
        return nativeJson(sellersHelp());
      case 'commissions': {
        const id = url.searchParams.get('id') || '';
        if (!uuid.test(id)) return failure('Nieprawidłowy sprzedawca.');
        return reply(await commissionAccount(ctx, 'partner', id));
      }
      case 'offer': {
        const id = url.searchParams.get('id') || '';
        if (!uuid.test(id)) return failure('Nieprawidłowa oferta.');
        return nativeJson(await sellerOfferReview(ctx, request, id));
      }
      case 'newSeller':
        return nativeJson(await newSellerSetup(ctx));
      case 'people':
        return nativeJson(await newSellerPeople(ctx, url.searchParams.get('source') || 'contact', (url.searchParams.get('q') || '').slice(0, 100)));
      case 'organizations':
        return nativeJson(await newSellerOrganizations(ctx, (url.searchParams.get('q') || '').slice(0, 100)));
      case 'conversations':
        return nativeJson(await sellerConversations(ctx, url.searchParams.get('id')));
      case 'messages':
        return nativeJson(await sellerChatMessages(ctx, url.searchParams.get('id'), url.searchParams.get('before')));
      case 'audit':
        return nativeJson(await sellerAudit(ctx, url.searchParams.get('id'), url.searchParams.get('limit')));
      case 'management':
        return nativeJson(await sellerManagement(ctx, url.searchParams.get('id')));
      case 'settings':
        return nativeJson(await sellerSettings(ctx, url.searchParams.get('id')));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-sellers]', error);
    return failure(errorText(error, 'Nie udało się wczytać sprzedawców.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 64_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  try {
    // Kreator „Nowy sprzedawca” — formularz zamiast identyfikatora.
    if (op === 'validate' || op === 'create') {
      const form = body.form && typeof body.form === 'object' && !Array.isArray(body.form) ? body.form as Record<string, unknown> : {};
      return nativeJson(op === 'validate' ? await validateNewSeller(ctx, form) : await createSeller(ctx, request, form));
    }
    if (!uuid.test(id)) return failure('Nieprawidłowe zapytanie.');
    switch (op) {
      case 'inquiryRespond': {
        const status = String(body.status || '');
        const response = typeof body.response === 'string' ? body.response.trim().slice(0, 4000) : '';
        if (!['in_progress', 'answered', 'closed'].includes(status)) return failure('Nieprawidłowy status zapytania.');
        if (status === 'answered' && !response) return failure('Wpisz odpowiedź, aby oznaczyć zapytanie jako odpowiedziane.');
        const { error } = await ctx.supabase.rpc('respond_seller_inquiry', { p_inquiry: id, p_status: status, p_response: response || null });
        if (error) throw error;
        return nativeJson({ ok: true, message: response ? 'Odpowiedź wysłana — sprzedawca dostał powiadomienie.' : 'Zapisano status zapytania.' });
      }
      case 'priceDecide': {
        const expected = typeof body.expectedKey === 'string' && body.expectedKey ? body.expectedKey : null;
        return nativeJson(await decideSellerOfferPrice(ctx, id, String(body.decision || ''), typeof body.note === 'string' ? body.note : '', expected));
      }
      // Konto prowizji sprzedawcy (`id` — profil sprzedawcy); uprawnienia sprawdza baza.
      case 'commissionApprove':
        return reply(await approveCommission(ctx, body));
      case 'commissionPayout':
        return reply(await payoutCommission(ctx, body));
      case 'commissionDeduct':
        return reply(await deductCommission(ctx, body));
      case 'commissionPayroll':
        return reply(await commissionPayroll(ctx, 'partner', id, body));
      case 'chatOpen':
        return nativeJson(await openSellerConversation(ctx, body));
      case 'chatSend':
        return nativeJson(await sendSellerChatMessage(ctx, body));
      case 'chatRead':
        return nativeJson(await readSellerChat(ctx, body));
      case 'manager':
        return nativeJson(await assignSellerManager(ctx, body));
      case 'visibility':
        return nativeJson(await setSellerCommissionVisibility(ctx, body));
      case 'settingsValidate':
        return nativeJson(await validateSellerSettings(ctx, body));
      case 'settingsSave':
        return nativeJson(await saveSellerSettings(ctx, request, body));
      case 'inquiryConvert': {
        const { data, error } = await ctx.supabase.rpc('convert_seller_inquiry', { p_inquiry: id });
        if (error) throw error;
        return nativeJson({ ok: true, inquiryId: typeof data === 'string' ? data : null, message: 'Utworzono zapytanie CRM.' });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-sellers]', error);
    const problems = (error as { problems?: unknown })?.problems;
    if (Array.isArray(problems)) return nativeJson({ error: errorText(error, 'Uzupełnij dane sprzedawcy.'), problems }, 400);
    return failure(errorText(error, 'Nie udało się zapisać zmiany.'), statusOf(error));
  }
}
