// Run from mobile: node scripts/test-seller-chat-routing.cjs
// No database/network calls: exercise the actual router with a navigation spy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const parser = load('src/lib/sellerChatTarget.ts', {});
const calls = [];
let stored = null;
let reads = 0;
const router = load('src/navigation/navigationRef.ts', {
  '@react-navigation/native': { createNavigationContainerRef: () => ({ isReady: () => true, navigate: (...args) => calls.push(args) }) },
  '../lib/sellerChatTarget': parser,
  '../lib/supabase': { supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { reads++; return { data: stored }; } }) }) }) } },
});
const id = '12345678-1234-4234-8234-123456789abc';
const event = 'abcdefab-1234-4234-8234-123456789abc';
let cases = 0;
async function expectSeller(target) {
  calls.length = 0;
  await router.routeNotification(target);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'Main');
  assert.equal(calls[0][1].screen, 'Messages');
  assert.equal(calls[0][1].params.conversationKind, 'seller');
  assert.equal(calls[0][1].params.conversationId, id);
  cases++;
}
(async () => {
  await expectSeller({ workflow: 'seller_chat', conversation_id: id });
  await expectSeller({ metadata: { workflow: 'seller_chat', conversation_id: id } });
  await expectSeller({ type: 'seller_message', conversation_id: id });
  for (const url of [
    `/crm/contacts/${event}?tab=seller&conversation=${id}`,
    `/crm/salespeople?seller=${event}&conversation=${id}`,
    `/crm/events/${event}?tab=seller-arrangements&conversation=${id}`,
    `/crm/offers/${event}?conversation=${id}#seller-offer-conversation`,
    `/seller/offers/${event}?conversation=${id}`,
    `/seller/realizations/${event}?conversation=${id}`,
  ]) await expectSeller({ action_url: url, entity_type: 'event', entity_id: event });
  assert.equal(reads, 0, 'Complete URL/metadata must work without an extra database lookup');
  stored = { metadata: { workflow: 'seller_chat', conversation_id: id }, category: 'system', related_entity_id: event };
  await expectSeller({ type: 'crm_notification', notification_id: event, entity_id: event });
  assert.equal(reads, 1, 'Hydrate old banners even when entity_id contains a seller message ID');
  calls.length = 0;
  await router.routeNotification({ type: 'chat_message', conversation_id: id });
  assert.equal(calls[0][1].params.conversationKind, 'employee');
  cases++;
  calls.length = 0;
  await router.routeNotification({ entity_type: 'event', entity_id: event });
  assert.equal(calls[0][1].screen, 'Events');
  cases++;
  assert.equal(parser.getSellerChatTarget({ type: 'chat_message', conversation_id: id }), null);
  assert.equal(parser.getSellerChatTarget({ action_url: `/crm/messages/${event}?conversation=${id}` }), null);
  assert.equal(parser.getSellerChatTarget({ action_url: '/crm/contacts/test?conversation=invalid' }), null);
  console.log(`${cases + 3} seller/employee/event routing checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
