/* Jednorazowe wdrożenie wspólnego układu. Bez --apply nie zapisuje danych. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(__dirname, 'shared-layout-2026-09-07');
const read = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
const products = read('products.json');
const categories = read('categories.json');
const template = read('template.json');
const journalPath = process.env.CONTRACT_ROLLOUT_JOURNAL || '/tmp/mavinci-contract-layout-2026-09-07.json';
if (!process.argv.includes('--apply') && !process.argv.includes('--rollback')) {
  console.log(JSON.stringify({template: template.name, templateId: template.id, products: products.length, categories: categories.length, usage: 'node scripts/contracts/rollout.cjs --apply | --rollback'}));
  process.exit(0);
}
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const db = require('@supabase/supabase-js').createClient(
  env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  {auth: {persistSession: false, autoRefreshToken: false}},
);
const unwrap = async (query) => { const {data, error} = await query; if (error) throw new Error(error.message); return data; };
let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : {templateId: template.id, products: [], categories: [], createdTemplate: false, status: 'prepared'};
const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
const requireOne = (rows, label) => { if (rows.length !== 1) throw new Error('Dane zmieniły się podczas zapisu: ' + label); return rows[0]; };
const nullableEq = (query, field, value) => value == null ? query.is(field, null) : query.eq(field, value);
async function rollback() {
  const problems = [];
  for (const change of [...journal.categories].reverse()) {
    try {
      requireOne(await unwrap(db.from('event_categories').update({contract_template_id: change.before}).eq('id', change.id).eq('contract_template_id', template.id).eq('updated_at', change.updated_at).select('id')), change.id);
      journal.categories = journal.categories.filter((row) => row.id !== change.id); save();
    } catch (error) { problems.push(error.message); }
  }
  for (const change of [...journal.products].reverse()) {
    try {
      const source = products.find((row) => row.id === change.id);
      requireOne(await unwrap(db.from('offer_products').update({recommended_contract_clauses: source.before}).eq('id', source.id).eq('updated_at', change.updated_at).select('id')), source.name);
      journal.products = journal.products.filter((row) => row.id !== change.id); save();
    } catch (error) { problems.push(error.message); }
  }
  // Kopia pozostaje dostępna do wglądu; nie usuwamy dokumentów ani szablonów.
  journal.status = problems.length ? 'rollback-needs-review' : 'rolled-back'; save();
  if (problems.length) throw new Error(problems.join('\n'));
  console.log('Przywrócono poprzednie klauzule i przypisania kategorii. Kopia szablonu pozostała w CRM.');
}
(async () => {
  if (journal.templateId !== template.id) throw new Error('Dziennik dotyczy innego wdrożenia.');
  if (process.argv.includes('--rollback')) return rollback();
  if (journal.status === 'complete') { console.log('Wdrożenie zostało już zapisane.'); return; }
  if (journal.products.length || journal.categories.length) throw new Error('Niedokończony zapis. Najpierw odtwórz stan przez --rollback.');
  const currentProducts = await unwrap(db.from('offer_products').select('id,recommended_contract_clauses,updated_at').in('id', products.map((p) => p.id)));
  const currentCategories = await unwrap(db.from('event_categories').select('id,contract_template_id,updated_at').in('id', categories.map((c) => c.id)));
  const productMap = new Map(currentProducts.map((p) => [p.id, p]));
  const categoryMap = new Map(currentCategories.map((c) => [c.id, c]));
  for (const p of products) if (productMap.get(p.id)?.recommended_contract_clauses !== p.before) throw new Error('Klauzule zmieniono od przygotowania wdrożenia: ' + p.name);
  for (const c of categories) if (!categoryMap.has(c.id) || categoryMap.get(c.id).contract_template_id !== c.before) throw new Error('Zmieniono przypisanie szablonu kategorii: ' + c.name);
  const existing = await unwrap(db.from('contract_templates').select('id,content_html').eq('id', template.id).maybeSingle());
  if (existing && existing.content_html !== template.content_html) throw new Error('Kopia szablonu została zmieniona.');
  journal.status = 'applying'; save();
  try {
    if (!existing) {
      await unwrap(db.from('contract_templates').insert(template));
      journal.createdTemplate = true; save();
    }
    for (const p of products) {
      const changed = requireOne(await unwrap(db.from('offer_products').update({recommended_contract_clauses: p.after}).eq('id', p.id).eq('updated_at', productMap.get(p.id).updated_at).select('id,updated_at')), p.name);
      journal.products.push(changed); save();
    }
    for (const c of categories) {
      let query = db.from('event_categories').update({contract_template_id: template.id}).eq('id', c.id).eq('updated_at', categoryMap.get(c.id).updated_at);
      query = nullableEq(query, 'contract_template_id', c.before);
      const changed = requireOne(await unwrap(query.select('id,updated_at')), c.name);
      journal.categories.push({...changed, before: c.before}); save();
    }
    journal.status = 'complete'; journal.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({status: journal.status, templateId: template.id, template: template.name, products: journal.products.length, categories: journal.categories.length, journal: journalPath}));
  } catch (error) {
    console.error('Zapis zatrzymany: ' + error.message);
    await rollback();
    throw error;
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
