import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TenderRecord {
  external_id: string;
  source: string;
  title: string;
  description: string;
  contracting_authority: string;
  cpv_codes: string[];
  location: string;
  publication_date: string | null;
  submission_deadline: string | null;
  estimated_value: number;
  currency: string;
  source_url: string;
  raw_data: Record<string, unknown>;
}

interface FilterConfig {
  positive_keywords: string[];
  negative_keywords: string[];
  cpv_codes: string[];
  min_relevance_score: number;
  max_days_to_deadline: number;
}

function calculateRelevanceScore(
  tender: TenderRecord,
  config: FilterConfig
): number {
  let score = 0;
  const textToSearch = `${tender.title} ${tender.description}`.toLowerCase();

  for (const keyword of config.positive_keywords) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score += 15;
    }
  }

  for (const keyword of config.negative_keywords) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score -= 20;
    }
  }

  if (tender.cpv_codes.length > 0) {
    for (const cpv of tender.cpv_codes) {
      const cpvBase = cpv.split("-")[0];
      for (const targetCpv of config.cpv_codes) {
        const targetBase = targetCpv.split("-")[0];
        if (cpvBase === targetBase) {
          score += 25;
        } else if (cpvBase.substring(0, 4) === targetBase.substring(0, 4)) {
          score += 10;
        }
      }
    }
  }

  return Math.max(0, Math.min(100, score));
}

async function fetchBZPNotices(pageSize = 50): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];

  try {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const dateFrom = weekAgo.toISOString().split("T")[0];

    const url = `https://ezamowienia.gov.pl/mo-board/api/v1/Board/Search?noticeType=ContractNotice&publicationDateFrom=${dateFrom}&size=${pageSize}&sort=publicationDate,desc`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TenderMonitor/1.0",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BZP API error: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }

    const data = await response.json();
    const notices = data.content || data.notices || data.results || [];

    if (Array.isArray(notices)) {
      for (const notice of notices) {
        const cpvCodes: string[] = [];
        if (notice.cpvCode) cpvCodes.push(String(notice.cpvCode));
        if (notice.cpvCodes && Array.isArray(notice.cpvCodes)) {
          cpvCodes.push(...notice.cpvCodes.map((c: unknown) => String(typeof c === 'object' && c !== null && 'code' in c ? (c as Record<string, unknown>).code : c)));
        }
        if (notice.mainCpvCode) cpvCodes.push(String(notice.mainCpvCode));

        const externalId =
          notice.bzpNumber || notice.noticeNumber || notice.id || notice.number || "";
        if (!externalId) continue;

        tenders.push({
          external_id: String(externalId),
          source: "bzp",
          title:
            notice.objectContract ||
            notice.title ||
            notice.name ||
            notice.orderObject ||
            "",
          description:
            notice.shortDescription ||
            notice.description ||
            notice.objectDescription ||
            notice.additionalInfo ||
            "",
          contracting_authority:
            notice.contractingAuthorityName ||
            notice.buyerName ||
            notice.organisationName ||
            notice.contractingAuthority?.name ||
            "",
          cpv_codes: cpvCodes,
          location:
            notice.city ||
            notice.location ||
            notice.place ||
            notice.contractingAuthority?.city ||
            "",
          publication_date: notice.publicationDate || null,
          submission_deadline:
            notice.tenderSubmissionDeadline ||
            notice.offerSubmissionDeadline ||
            notice.deadline ||
            notice.submissionDate ||
            null,
          estimated_value: Number(
            notice.totalValue || notice.estimatedValue || notice.orderValue || 0
          ),
          currency: notice.currency || "PLN",
          source_url: `https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/${encodeURIComponent(String(externalId))}`,
          raw_data: notice,
        });
      }
    }
  } catch (error) {
    console.error("BZP fetch error:", error);
    throw error;
  }

  return tenders;
}

async function fetchTEDNotices(pageSize = 50): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];

  try {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const dateFrom = weekAgo.toISOString().split("T")[0];

    const searchBody = {
      query: `PD>=${dateFrom} AND CY=PL`,
      pageSize: pageSize,
      pageNum: 1,
      sortField: "PD",
      sortOrder: "desc",
    };

    const response = await fetch(
      "https://api.ted.europa.eu/v3/notices/search",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(searchBody),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `TED API error: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }

    const data = await response.json();
    const notices = data.notices || data.results || [];

    if (Array.isArray(notices)) {
      for (const notice of notices) {
        const externalId =
          notice.noticeId || notice["ND"] || notice.id || notice.documentNumber || "";
        if (!externalId) continue;

        const cpvCodes: string[] = [];
        if (notice.cpvCodes) {
          cpvCodes.push(
            ...(Array.isArray(notice.cpvCodes)
              ? notice.cpvCodes.map((c: unknown) => String(c))
              : [String(notice.cpvCodes)])
          );
        }
        if (notice["CPV"]) cpvCodes.push(String(notice["CPV"]));
        if (notice.cpv) cpvCodes.push(String(notice.cpv));

        tenders.push({
          external_id: String(externalId),
          source: "ted",
          title: notice.title || notice["TI"] || notice.titleEnglish || "",
          description:
            notice.description ||
            notice.summary ||
            notice["TX"] ||
            notice.shortDescription ||
            "",
          contracting_authority:
            notice.buyerName ||
            notice["AA"] ||
            notice.contractingAuthority ||
            notice.caName ||
            "",
          cpv_codes: cpvCodes,
          location:
            notice.town || notice["TW"] || notice.place || notice.city || "Polska",
          publication_date: notice.publicationDate || notice["PD"] || null,
          submission_deadline: notice.deadline || notice["DT"] || notice.timeLimit || null,
          estimated_value: Number(
            notice.estimatedValue || notice.totalValue || notice.valueEuro || 0
          ),
          currency: notice.currency || "EUR",
          source_url: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(String(externalId))}`,
          raw_data: notice,
        });
      }
    }
  } catch (error) {
    console.error("TED fetch error:", error);
    throw error;
  }

  return tenders;
}

async function fetchBazaKonkurencyjnosci(
  pageSize = 50
): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];

  try {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const dateFrom = weekAgo.toISOString().split("T")[0];

    const searchUrl = `https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements?dateFrom=${dateFrom}&limit=${pageSize}&orderBy=publication_date&orderType=desc`;

    const response = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TenderMonitor/1.0",
      },
    });

    if (!response.ok) {
      console.warn(
        `Baza Konkurencyjnosci API returned ${response.status} - skipping source`
      );
      return tenders;
    }

    const data = await response.json();
    const notices =
      data.data || data.announcements || data.items || data.results || [];

    if (Array.isArray(notices)) {
      for (const notice of notices) {
        const externalId = notice.id || notice.number || notice.announcementId || "";
        if (!externalId) continue;

        const cpvCodes: string[] = [];
        if (notice.cpvCodes && Array.isArray(notice.cpvCodes)) {
          cpvCodes.push(
            ...notice.cpvCodes.map((c: unknown) =>
              String(typeof c === "object" && c !== null && "code" in c ? (c as Record<string, unknown>).code : c)
            )
          );
        }
        if (notice.cpvCode) cpvCodes.push(String(notice.cpvCode));

        tenders.push({
          external_id: String(externalId),
          source: "baza_konkurencyjnosci",
          title: notice.title || notice.name || notice.subject || "",
          description: notice.description || notice.content || notice.text || "",
          contracting_authority:
            notice.beneficiary ||
            notice.publisher ||
            notice.company ||
            notice.organizationName ||
            "",
          cpv_codes: cpvCodes,
          location:
            notice.location ||
            notice.province ||
            notice.city ||
            notice.voivodeship ||
            "",
          publication_date:
            notice.publicationDate || notice.createdAt || notice.publishDate || null,
          submission_deadline:
            notice.submissionDeadline ||
            notice.offerDeadline ||
            notice.applicationDeadline ||
            null,
          estimated_value: Number(
            notice.value || notice.estimatedValue || notice.orderValue || 0
          ),
          currency: notice.currency || "PLN",
          source_url: `https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/ogloszenia/${encodeURIComponent(String(externalId))}`,
          raw_data: notice,
        });
      }
    }
  } catch (error) {
    console.error("Baza Konkurencyjnosci fetch error:", error);
    throw error;
  }

  return tenders;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const sourceParam = url.searchParams.get("source");

    const { data: filterConfigs } = await supabase
      .from("tender_filter_config")
      .select("*")
      .eq("is_active", true)
      .limit(1);

    const config: FilterConfig = filterConfigs?.[0] || {
      positive_keywords: [],
      negative_keywords: [],
      cpv_codes: [],
      min_relevance_score: 30,
      max_days_to_deadline: 60,
    };

    const sources = sourceParam
      ? [sourceParam]
      : ["bzp", "ted", "baza_konkurencyjnosci"];

    const results: Record<
      string,
      {
        success: boolean;
        count: number;
        new: number;
        updated: number;
        error?: string;
      }
    > = {};

    for (const source of sources) {
      const logEntry = {
        source,
        status: "running",
        records_fetched: 0,
        records_new: 0,
        records_updated: 0,
      };

      const { data: logRow } = await supabase
        .from("tender_import_logs")
        .insert(logEntry)
        .select("id")
        .single();

      const logId = logRow?.id;

      try {
        let tenders: TenderRecord[] = [];

        switch (source) {
          case "bzp":
            tenders = await fetchBZPNotices();
            break;
          case "ted":
            tenders = await fetchTEDNotices();
            break;
          case "baza_konkurencyjnosci":
            tenders = await fetchBazaKonkurencyjnosci();
            break;
        }

        let newCount = 0;
        let updatedCount = 0;

        for (const tender of tenders) {
          const relevanceScore = calculateRelevanceScore(tender, config);
          const isMatched = relevanceScore >= config.min_relevance_score;

          const record = {
            ...tender,
            relevance_score: relevanceScore,
            is_matched: isMatched,
            updated_at: new Date().toISOString(),
          };

          const { data: existing } = await supabase
            .from("tenders")
            .select("id")
            .eq("source", tender.source)
            .eq("external_id", tender.external_id)
            .maybeSingle();

          if (existing) {
            await supabase
              .from("tenders")
              .update({
                title: record.title,
                description: record.description,
                contracting_authority: record.contracting_authority,
                cpv_codes: record.cpv_codes,
                location: record.location,
                publication_date: record.publication_date,
                submission_deadline: record.submission_deadline,
                estimated_value: record.estimated_value,
                currency: record.currency,
                source_url: record.source_url,
                raw_data: record.raw_data,
                relevance_score: record.relevance_score,
                is_matched: record.is_matched,
                updated_at: record.updated_at,
              })
              .eq("id", existing.id);
            updatedCount++;
          } else {
            await supabase.from("tenders").insert(record);
            newCount++;
          }
        }

        if (logId) {
          await supabase
            .from("tender_import_logs")
            .update({
              status: "success",
              finished_at: new Date().toISOString(),
              records_fetched: tenders.length,
              records_new: newCount,
              records_updated: updatedCount,
            })
            .eq("id", logId);
        }

        results[source] = {
          success: true,
          count: tenders.length,
          new: newCount,
          updated: updatedCount,
        };
      } catch (sourceError) {
        const errorMsg =
          sourceError instanceof Error ? sourceError.message : String(sourceError);
        console.error(`Error fetching ${source}:`, errorMsg);

        if (logId) {
          await supabase
            .from("tender_import_logs")
            .update({
              status: "error",
              finished_at: new Date().toISOString(),
              error_message: errorMsg,
            })
            .eq("id", logId);
        }

        results[source] = {
          success: false,
          count: 0,
          new: 0,
          updated: 0,
          error: errorMsg,
        };
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Fatal error in fetch-tenders:", errorMsg);
    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
