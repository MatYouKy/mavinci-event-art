import CasinoRulesArticle from '@/components/Layout/CasinoRulesArticle';
import { casinoRuleMetadata, getCasinoRule } from '@/lib/SEO/casinoRules.server';

export const dynamic = 'force-dynamic';
export function generateMetadata() { return casinoRuleMetadata('ruletka'); }
export default async function CasinoRulePage() {
  return <CasinoRulesArticle rule={await getCasinoRule('ruletka')} />;
}
