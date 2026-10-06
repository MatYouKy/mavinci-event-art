import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { scenarios } from './scenarios.mjs';
const db = new PGlite();
try {
 await db.exec(fs.readFileSync(new URL('./fixture.sql',import.meta.url),'utf8'));
 for (const name of ['20260926120000_inquiry_sales_workflow.sql','20260926123000_inquiry_intake_reconciliation.sql']) {
  try { await db.exec(fs.readFileSync(new URL('../../migrations/'+name, import.meta.url),'utf8')); console.log('Migration OK:',name); }
  catch(e){ console.error('Migration failed:',name,e.message,'position',e.position,'context',e.where); process.exitCode=1; break; }
 }
 if (!process.exitCode) { await db.exec('CREATE TRIGGER trigger_auto_generate_offer_number BEFORE INSERT ON offers FOR EACH ROW EXECUTE FUNCTION auto_generate_offer_number(); CREATE TRIGGER track_offer_modifications BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION mark_offer_modified();'); await scenarios(db); }
} catch (e) { console.error(e.message, e.where); process.exitCode=1; } finally { await db.close(); }
