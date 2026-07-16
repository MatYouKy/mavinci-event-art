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

const HARD_NEGATIVE_CPV_PREFIXES = ["45"];

function calculateRelevanceScore(
  tender: TenderRecord,
  config: FilterConfig
): number {
  let score = 0;
  const textToSearch = `${tender.title} ${tender.description} ${tender.contracting_authority}`.toLowerCase();

  const hasHardNegativeCpv = tender.cpv_codes.some((cpv) =>
    HARD_NEGATIVE_CPV_PREFIXES.some((prefix) =>
      cpv.replace("-", "").startsWith(prefix)
    )
  );
  if (hasHardNegativeCpv) {
    score -= 50;
  }

  for (const keyword of config.positive_keywords) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score += 15;
    }
  }

  for (const keyword of config.negative_keywords) {
    if (textToSearch.includes(keyword.toLowerCase())) {
      score -= 25;
    }
  }

  if (tender.cpv_codes.length > 0) {
    for (const cpv of tender.cpv_codes) {
      const cpvBase = cpv.split("-")[0];
      for (const targetCpv of config.cpv_codes) {
        const targetBase = targetCpv.split("-")[0];
        if (cpvBase === targetBase) {
          score += 35;
        } else if (cpvBase.substring(0, 4) === targetBase.substring(0, 4)) {
          score += 15;
        }
      }
    }
  }

  if (tender.submission_deadline) {
    const deadline = new Date(tender.submission_deadline);
    const now = new Date();
    const daysLeft = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysLeft < 0) {
      score -= 100;
    } else if (daysLeft <= 7) {
      score += 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function getDateFrom(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}

async function fetchBZPNotices(
  cpvCodes: string[],
  pageSize = 100
): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];
  const seenIds = new Set<string>();
  const dateFrom = getDateFrom(30);

  // BZP Board/Search supports `cpvCode` param for filtering by main CPV code division.
  // We batch by CPV 2-digit divisions extracted from our configured codes.
  const cpvDivisions = [
    ...new Set(cpvCodes.map((c) => c.replace("-", "").substring(0, 2))),
  ];

  // Also do one broad search without CPV filter to catch notices that might match by keywords
  const searchBatches: Array<{ cpvCode?: string; label: string }> = [
    { label: "broad" },
  ];
  for (const div of cpvDivisions) {
    searchBatches.push({ cpvCode: div, label: `CPV ${div}` });
  }

  for (const batch of searchBatches) {
    try {
      let url = `https://ezamowienia.gov.pl/mo-board/api/v1/Board/Search?noticeType=ContractNotice&publicationDateFrom=${dateFrom}&size=${pageSize}&sort=publicationDate,desc`;
      if (batch.cpvCode) {
        url += `&cpvCode=${batch.cpvCode}`;
      }

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "TenderMonitor/1.0",
        },
      });

      if (!response.ok) {
        console.warn(`BZP batch ${batch.label} error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const notices = data.content || data.notices || data.results || [];

      if (!Array.isArray(notices)) continue;

      for (const notice of notices) {
        const cpvCodesArr: string[] = [];
        if (notice.cpvCode) cpvCodesArr.push(String(notice.cpvCode));
        if (notice.cpvCodes && Array.isArray(notice.cpvCodes)) {
          cpvCodesArr.push(
            ...notice.cpvCodes.map((c: unknown) =>
              String(
                typeof c === "object" && c !== null && "code" in c
                  ? (c as Record<string, unknown>).code
                  : c
              )
            )
          );
        }
        if (notice.mainCpvCode) cpvCodesArr.push(String(notice.mainCpvCode));

        const externalId =
          notice.bzpNumber ||
          notice.noticeNumber ||
          notice.id ||
          notice.number ||
          "";
        if (!externalId || seenIds.has(String(externalId))) continue;
        seenIds.add(String(externalId));

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
          cpv_codes: cpvCodesArr,
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
    } catch (error) {
      console.error(`BZP batch ${batch.label} fetch error:`, error);
    }
  }

  return tenders;
}

async function fetchTEDNotices(
  cpvCodes: string[],
  pageSize = 100
): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];
  const seenIds = new Set<string>();

  // TED Search API v3 - tested and verified format.
  // Uses expert query syntax with POST to /v3/notices/search
  // Country field: organisation-country-buyer=POL (3-letter ISO code)
  // CPV filter: classification-cpv=XX* (wildcard for division)
  // Notice type: notice-type=cn-standard (contract notices)
  const cpvDivisions = [
    ...new Set(cpvCodes.map((c) => c.replace("-", "").substring(0, 2))),
  ];

  const queries: string[] = [];

  // CPV-specific queries (main value)
  if (cpvDivisions.length > 0) {
    for (const div of cpvDivisions) {
      queries.push(
        `organisation-country-buyer=POL AND notice-type=cn-standard AND classification-cpv=${div}*`
      );
    }
  }

  // Also a broad Polish contract notices query
  queries.push(
    "organisation-country-buyer=POL AND notice-type=cn-standard"
  );

  const TED_FIELDS = [
    "notice-title",
    "publication-date",
    "classification-cpv",
    "buyer-name",
    "deadline-receipt-request",
  ];

  for (const query of queries) {
    try {
      const searchBody = {
        query,
        fields: TED_FIELDS,
        page: 1,
        limit: Math.min(pageSize, 100),
        scope: "ACTIVE",
        paginationMode: "PAGE_NUMBER",
        checkQuerySyntax: false,
        onlyLatestVersions: true,
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
        console.warn(
          `TED query error (${query.substring(0, 60)}): ${response.status} - ${text.substring(0, 200)}`
        );
        continue;
      }

      const data = await response.json();
      const notices = data.notices || [];

      if (!Array.isArray(notices)) continue;

      for (const notice of notices) {
        const externalId = notice["publication-number"] || "";
        if (!externalId || seenIds.has(String(externalId))) continue;
        seenIds.add(String(externalId));

        // CPV codes come as array of strings
        const cpvCodesArr: string[] = [];
        const rawCpv = notice["classification-cpv"];
        if (Array.isArray(rawCpv)) {
          // Deduplicate CPV codes (TED often duplicates per lot)
          const uniqueCpv = [...new Set(rawCpv.map((c: unknown) => String(c)))];
          cpvCodesArr.push(...uniqueCpv);
        }

        // Title is an object with language keys: {pol: ["..."], eng: ["..."]}
        const titleObj = notice["notice-title"] || {};
        const titleArr =
          titleObj["pol"] || titleObj["eng"] || Object.values(titleObj)[0];
        const title = Array.isArray(titleArr) ? titleArr[0] : String(titleArr || "");

        // Buyer name is similarly structured
        const buyerObj = notice["buyer-name"] || {};
        const buyerArr =
          buyerObj["pol"] || buyerObj["eng"] || Object.values(buyerObj)[0];
        const buyerName = Array.isArray(buyerArr) ? buyerArr[0] : String(buyerArr || "");

        // Deadline
        const deadlineArr = notice["deadline-receipt-request"];
        const deadline = Array.isArray(deadlineArr)
          ? deadlineArr[0]
          : deadlineArr || null;

        // Publication date
        const pubDate = notice["publication-date"] || null;

        tenders.push({
          external_id: String(externalId),
          source: "ted",
          title,
          description: title, // TED search doesn't return full description
          contracting_authority: buyerName,
          cpv_codes: cpvCodesArr,
          location: "Polska",
          publication_date: pubDate
            ? pubDate.replace("Z", "")
            : null,
          submission_deadline: deadline || null,
          estimated_value: 0,
          currency: "EUR",
          source_url: `https://ted.europa.eu/pl/notice/-/detail/${encodeURIComponent(String(externalId))}`,
          raw_data: notice,
        });
      }
    } catch (error) {
      console.error(`TED query error:`, error);
    }
  }

  return tenders;
}

async function fetchBazaKonkurencyjnosci(
  cpvCodes: string[],
  _pageSize = 100
): Promise<TenderRecord[]> {
  const tenders: TenderRecord[] = [];

  // Baza Konkurencyjnosci (bazakonkurencyjnosci.funduszeeuropejskie.gov.pl)
  // requires OAuth2 authentication via Keycloak (id.funduszeeuropejskie.gov.pl).
  // There is no public API. This function attempts to use the API with optional
  // credentials from environment variables.
  const clientId = Deno.env.get("BAZA_KONKURENCYJNOSCI_CLIENT_ID");
  const clientSecret = Deno.env.get("BAZA_KONKURENCYJNOSCI_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.warn(
      "Baza Konkurencyjnosci: Brak konfiguracji API (BAZA_KONKURENCYJNOSCI_CLIENT_ID, BAZA_KONKURENCYJNOSCI_CLIENT_SECRET). Pomijam."
    );
    return tenders;
  }

  try {
    // Obtain OAuth2 token from Keycloak
    const tokenResponse = await fetch(
      "https://id.funduszeeuropejskie.gov.pl/realms/39465bb8-204c-446c-aeed-70db65bc9607/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }
    );

    if (!tokenResponse.ok) {
      console.warn(
        `Baza Konkurencyjnosci: Token error ${tokenResponse.status}`
      );
      return tenders;
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.warn("Baza Konkurencyjnosci: Nie otrzymano tokenu");
      return tenders;
    }

    // Fetch announcements with the token
    const params = new URLSearchParams({
      page: "1",
      limit: "100",
    });

    if (cpvCodes.length > 0) {
      params.set("cpvList", cpvCodes.join(","));
    }

    const searchUrl = `https://bazakonkurencyjnosci.funduszeeuropejskie.gov.pl/api/announcements?${params.toString()}`;

    const response = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.warn(
        `Baza Konkurencyjnosci API: ${response.status} - ${await response.text().catch(() => "")}`
      );
      return tenders;
    }

    const data = await response.json();
    const notices =
      data.data || data.announcements || data.items || data.results || [];

    if (Array.isArray(notices)) {
      const seenIds = new Set<string>();
      for (const notice of notices) {
        const externalId =
          notice.id || notice.number || notice.announcementId || "";
        if (!externalId || seenIds.has(String(externalId))) continue;
        seenIds.add(String(externalId));

        const cpvCodesArr: string[] = [];
        if (notice.cpvCodes && Array.isArray(notice.cpvCodes)) {
          cpvCodesArr.push(
            ...notice.cpvCodes.map((c: unknown) =>
              String(
                typeof c === "object" && c !== null && "code" in c
                  ? (c as Record<string, unknown>).code
                  : c
              )
            )
          );
        }
        if (notice.cpvCode) cpvCodesArr.push(String(notice.cpvCode));

        tenders.push({
          external_id: String(externalId),
          source: "baza_konkurencyjnosci",
          title: notice.title || notice.name || notice.subject || "",
          description:
            notice.description || notice.content || notice.text || "",
          contracting_authority:
            notice.beneficiary ||
            notice.publisher ||
            notice.company ||
            notice.organizationName ||
            "",
          cpv_codes: cpvCodesArr,
          location:
            notice.location ||
            notice.province ||
            notice.city ||
            notice.voivodeship ||
            "",
          publication_date:
            notice.publicationDate ||
            notice.createdAt ||
            notice.publishDate ||
            null,
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
        matched: number;
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
            tenders = await fetchBZPNotices(config.cpv_codes);
            break;
          case "ted":
            tenders = await fetchTEDNotices(config.cpv_codes);
            break;
          case "baza_konkurencyjnosci":
            tenders = await fetchBazaKonkurencyjnosci(config.cpv_codes);
            break;
        }

        let newCount = 0;
        let updatedCount = 0;
        let matchedCount = 0;

        for (const tender of tenders) {
          const relevanceScore = calculateRelevanceScore(tender, config);
          const isMatched = relevanceScore >= config.min_relevance_score;
          if (isMatched) matchedCount++;

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
          matched: matchedCount,
        };
      } catch (sourceError) {
        const errorMsg =
          sourceError instanceof Error
            ? sourceError.message
            : String(sourceError);
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
          matched: 0,
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
