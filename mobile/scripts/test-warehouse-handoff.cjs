// Run from mobile: node scripts/test-warehouse-handoff.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const { canAcceptWarehouseHandoff: canAccept, matchesWarehouseFilter: matches, warehouseOwnerLabel: label } = load('lib/warehouseHandoff.ts');
const handoff = { event_id: 'event', accepted_at: '2026-09-28T10:00:00Z', accepted_by: 'worker-a', accepted_by_name: 'Anna', ready_at: null, ready_by_name: null };
assert.equal(canAccept('offer_accepted', null), true);
assert.equal(canAccept('in_preparation', null), true);
for (const status of ['inquiry', 'offer_sent', 'ready_for_live', 'in_progress', 'completed', 'cancelled', 'invoiced', 'settled']) {
  assert.equal(canAccept(status, null), false, status);
}
assert.equal(canAccept('in_preparation', handoff), false);
assert.equal(matches('pending', 'offer_accepted', undefined, 'worker-a'), false, 'Failed read must not appear as unclaimed');
assert.equal(matches('pending', 'offer_accepted', null, 'worker-a'), true);
assert.equal(matches('mine', 'in_preparation', handoff, 'worker-a'), true);
assert.equal(matches('mine', 'in_preparation', handoff, 'worker-b'), false);
assert.equal(matches('mine', 'in_preparation', handoff), false);
assert.equal(matches('mine', 'in_preparation', { ...handoff, accepted_at: null }, 'worker-a'), false);
assert.equal(label(handoff, 'worker-a'), 'Przygotowanie magazynowe: Ty');
assert.equal(label(handoff, 'worker-b'), 'Przygotowanie magazynowe: Anna');
const calls = [];
const router = load('navigation/navigationRef.ts', {
  '@react-navigation/native': { createNavigationContainerRef: () => ({ isReady: () => true, navigate: (...args) => calls.push(args) }) },
  '../lib/sellerChatTarget': load('lib/sellerChatTarget.ts'),
  '../lib/supabase': { supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { related_entity_type: 'event', related_entity_id: 'event', metadata: { warehouse_key: 'warehouse-request:event' } } }) }) }) }) } },
});
(async () => {
  await router.routeNotification({ type: 'crm_notification', notification_id: 'notice', entity_id: 'event' });
  assert.deepEqual(calls.at(-1)[1], { screen: 'Events', params: { screen: 'EventDetail', params: { eventId: 'event', initialTab: 'warehouse' } } });
  await router.routeNotification({ entity_type: 'event', entity_id: 'event', initial_tab: 'warehouse' });
  assert.equal(calls.at(-1)[1].params.params.initialTab, 'warehouse');
  await router.routeNotification({ entity_type: 'event', entity_id: 'event', initial_tab: 'fleet' });
  assert.equal(calls.at(-1)[1].params.params.initialTab, 'fleet');
  await router.routeNotification({ entity_type: 'event', entity_id: 'event' });
  assert.equal(calls.at(-1)[1].params.params.initialTab, undefined);
  console.log('Warehouse eligibility, ownership filters and notification routing passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
