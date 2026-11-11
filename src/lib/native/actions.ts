import 'server-only';
import type { NativeContext } from './auth';
import { nativeJson } from './auth';
import { invalidateNativeSync } from './sync';

/*
 * Jedno wejście dla czynności z kart natywnych (`POST /bridge/native/v1/docs/action`): {action, id, revision, key, data}.
 * Każda czynność ma swoją funkcję wspólną z CRM (te same zapisy i RPC, token pracownika → RLS). Po zapisie unieważniamy migawki synchronizacji.
 * `key` (8–100 znaków) — jednokrotny zapis: ponowienie tej samej próby zwraca zapamiętaną odpowiedź.
 */
type Handler = (ctx: NativeContext, input: { id: string; revision: number; data: Record<string, unknown> }) => Promise<{ status: number; body: Record<string, unknown> }>;
const handlers: Record<string, { sets: string[]; run: Handler }> = {};

const done = new Map<string, { at: number; status: number; body: Record<string, unknown> }>();
const keyTtl = 10 * 60_000;

export async function handleNativeAction(ctx: NativeContext, body: any) {
  const action = String(body?.action || '');
  const id = String(body?.id || '');
  const key = String(body?.key || '');
  const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : {};
  const handler = handlers[action];
  if (!handler) return nativeJson({ error: 'Ta czynność nie jest jeszcze dostępna w aplikacji. Otwórz sprawę w CRM.' }, 400);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) return nativeJson({ error: 'Nieprawidłowy klucz zapisu. Zaktualizuj aplikację.' }, 400);
  const memo = `${ctx.employee.id}:${key}`;
  const previous = done.get(memo);
  if (previous && Date.now() - previous.at < keyTtl) return nativeJson(previous.body, previous.status);
  const result = await handler.run(ctx, { id, revision: Number(body?.revision || 0), data });
  if (result.status === 200) {
    invalidateNativeSync(handler.sets);
    done.set(memo, { at: Date.now(), ...result });
    if (done.size > 2000) for (const [k, v] of done) if (Date.now() - v.at > keyTtl) done.delete(k);
  }
  return nativeJson(result.body, result.status);
}
