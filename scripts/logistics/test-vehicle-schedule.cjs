const fs = require('fs'),
  ts = require(process.cwd() + '/node_modules/typescript'),
  assert = require('node:assert/strict');
function load(path) {
  const m = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
  )((id) => (id.startsWith('@/') ? load('src/' + id.slice(2) + '.ts') : require(id)), m, m.exports);
  return m.exports;
}
const { vehicleBoundaryOptions: options, resolveVehiclePhases: resolve } = load(
  'src/lib/CRM/events/vehicleSchedule.ts',
);
assert.deepEqual(
  options([], 'pickup').map((x) => x.id),
  ['local:loading', 'local:outbound'],
);
assert.deepEqual(
  options([], 'return').map((x) => x.id),
  ['local:teardown', 'local:inbound', 'local:unloading'],
);
const phases = [
  {
    id: 'setup',
    name: 'Montaż',
    start_time: '2026-09-21T08:00:00Z',
    end_time: '2026-09-21T12:00:00Z',
  },
];
const base = {
  independent_schedule: true,
  phase_from_id: 'local:outbound',
  phase_to_id: 'local:unloading',
  pickup_time: '2026-09-23T01:00',
  return_time: '2026-09-23T05:00',
};
let result = resolve(phases, base);
assert.equal(result.length, 2);
assert.equal(Date.parse(result[1].end_time) - Date.parse(result[0].start_time), 4 * 3600000);
assert.deepEqual(resolve(phases, { ...base, return_time: '' }), []);
assert.deepEqual(resolve(phases, { ...base, pickup_time: 'invalid' }), []);
result = resolve(phases, { ...base, phase_from_id: 'setup', phase_to_id: 'setup' });
assert.equal(result.length, 1);
assert.equal(Date.parse(result[0].end_time) - Date.parse(result[0].start_time), 4 * 3600000);
assert.equal(resolve(phases, { ...base, independent_schedule: false }), phases);
assert.equal(phases[0].start_time, '2026-09-21T08:00:00Z');
console.log(
  'PASS: stages without timeline, independent multi-day journeys, same-phase boundaries, invalid/missing dates, legacy mode.',
);
require(process.cwd() + '/node_modules/next/dist/build/swc')
  .transform(fs.readFileSync('src/components/crm/AddEventVehicleModal.tsx', 'utf8'), {
    filename: 'AddEventVehicleModal.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2020' },
    module: { type: 'es6' },
  })
  .then(() => console.log('PASS: Next.js compilation of modal'));
