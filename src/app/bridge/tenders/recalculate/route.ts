import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type TenderRecord = {
  id: string;
  title: string | null;
  description: string | null;
  contracting_authority: string | null;
  cpv_codes: string[] | null;
  submission_deadline: string | null;
};

type FilterConfig = {
  positive_keywords: string[];
  negative_keywords: string[];
  cpv_codes: string[];
  min_relevance_score: number;
  max_days_to_deadline: number;
};

function calculateRelevanceScore(tender: TenderRecord, config: FilterConfig): number {
  let score = 0;

  const textToSearch = `
    ${tender.title || ''}
    ${tender.description || ''}
    ${tender.contracting_authority || ''}
  `.toLowerCase();

  const cpvCodes = tender.cpv_codes || [];

  const hardNegativeCpvPrefixes = ['45'];

  const hasHardNegativeCpv = cpvCodes.some((cpv) =>
    hardNegativeCpvPrefixes.some((prefix) => cpv.replace('-', '').startsWith(prefix)),
  );

  if (hasHardNegativeCpv) {
    score -= 50;
  }

  for (const keyword of config.positive_keywords || []) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score += 15;
    }
  }

  for (const keyword of config.negative_keywords || []) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score -= 25;
    }
  }

  for (const cpv of cpvCodes) {
    const cpvBase = cpv.split('-')[0];

    for (const targetCpv of config.cpv_codes || []) {
      const targetBase = targetCpv.split('-')[0];

      if (cpvBase === targetBase) {
        score += 35;
      } else if (cpvBase.substring(0, 4) === targetBase.substring(0, 4)) {
        score += 15;
      }
    }
  }

  if (tender.submission_deadline) {
    const deadline = new Date(tender.submission_deadline);
    const now = new Date();

    const daysLeft = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysLeft < 0) {
      score -= 100;
    }

    if (daysLeft >= 0 && daysLeft <= 7) {
      score += 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

export async function POST() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'Brak konfiguracji Supabase env' },
        { status: 500 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: config, error: configError } = await supabase
      .from('tender_filter_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        { success: false, error: configError?.message || 'Brak aktywnej konfiguracji' },
        { status: 400 },
      );
    }

    const { data: tenders, error: tendersError } = await supabase
      .from('tenders')
      .select('id,title,description,contracting_authority,cpv_codes,submission_deadline');

    if (tendersError) {
      return NextResponse.json(
        { success: false, error: tendersError.message },
        { status: 500 },
      );
    }

    let updated = 0;

    for (const tender of tenders || []) {
      const relevanceScore = calculateRelevanceScore(tender, config);
      const isMatched = relevanceScore >= config.min_relevance_score;

      const { error: updateError } = await supabase
        .from('tenders')
        .update({
          relevance_score: relevanceScore,
          is_matched: isMatched,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tender.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      updated++;
    }

    return NextResponse.json({
      success: true,
      updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}