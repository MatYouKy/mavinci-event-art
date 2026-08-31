import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const WORKFLOW_RELATED_TABLES = [
  "offers",
  "contracts",
  "employee_assignments",
  "event_equipment",
  "event_vehicles",
  "event_agendas",
  "invoices",
  "wedding_cards",
  "event_payment_milestones",
  "event_closeouts",
] as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const accessToken = (req.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!accessToken) return json({ error: "Brak aktywnej sesji." }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    const userId = userData.user?.id;
    if (userError || !userId) return json({ error: "Sesja wygasła. Zaloguj się ponownie." }, 401);

    const payload = (await req.json()) as { eventId?: string };
    if (!payload.eventId) return json({ error: "Brak identyfikatora wydarzenia." }, 400);

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, role, access_level, permissions, is_active")
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (employeeError || !employee) return json({ error: "Nie znaleziono aktywnego pracownika." }, 403);

    const permissions = Array.isArray(employee.permissions) ? employee.permissions : [];
    const isAdmin =
      employee.role === "admin" ||
      employee.access_level === "admin" ||
      permissions.includes("admin");
    if (!isAdmin) return json({ error: "Tylko administrator może trwale usunąć wydarzenie." }, 403);

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, name")
      .eq("id", payload.eventId)
      .maybeSingle();
    if (eventError) throw new Error(`Nie udało się sprawdzić wydarzenia: ${eventError.message}`);
    if (!event) return json({ error: "Wydarzenie nie istnieje lub zostało już usunięte." }, 404);

    const [invoicesResult, financialEntriesResult, milestonesResult, contractsResult] =
      await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("event_id", event.id),
        supabase.from("financial_entries").select("id", { count: "exact", head: true }).eq("event_id", event.id),
        supabase.from("event_payment_milestones").select("id, status").eq("event_id", event.id),
        supabase.from("contracts").select("id, status").eq("event_id", event.id),
      ]);

    for (const result of [invoicesResult, financialEntriesResult, milestonesResult, contractsResult]) {
      if (result.error) throw new Error(`Nie udało się sprawdzić rozliczeń: ${result.error.message}`);
    }

    const paidMilestones = (milestonesResult.data || []).filter((row: { status?: string | null }) =>
      ["paid", "partially_paid", "completed", "settled"].includes(String(row.status || "").toLowerCase()),
    );
    const signedContracts = (contractsResult.data || []).filter((row: { status?: string | null }) =>
      ["signed", "signed_by_client", "signed_returned", "completed", "active"].includes(
        String(row.status || "").toLowerCase(),
      ),
    );

    if (
      (invoicesResult.count || 0) > 0 ||
      (financialEntriesResult.count || 0) > 0 ||
      paidMilestones.length > 0 ||
      signedContracts.length > 0
    ) {
      return json(
        {
          error:
            "Wydarzenie ma dokumenty księgowe, zaksięgowane płatności lub podpisaną umowę. Ze względów księgowych nie może zostać trwale usunięte — anuluj je albo najpierw rozwiąż powiązane rozliczenia.",
          code: "EVENT_HAS_PROTECTED_RECORDS",
        },
        409,
      );
    }

    const [{ data: eventFiles }, { data: offerFiles }] = await Promise.all([
      supabase.from("event_files").select("file_path").eq("event_id", event.id),
      supabase.from("offers").select("generated_pdf_url").eq("event_id", event.id),
    ]);

    // These relations have AFTER DELETE workflow triggers. They must disappear
    // while the parent event still exists; otherwise a cascade can try to
    // recreate a workflow instance for a deleted event.
    for (const table of WORKFLOW_RELATED_TABLES) {
      const { error } = await supabase.from(table).delete().eq("event_id", event.id);
      if (error) throw new Error(`Nie udało się usunąć zależności ${table}: ${error.message}`);
    }

    const { error: workflowError } = await supabase
      .from("event_workflow_instances")
      .delete()
      .eq("event_id", event.id);
    if (workflowError) throw new Error(`Nie udało się zamknąć workflow: ${workflowError.message}`);

    const { data: deletedEvent, error: deleteError } = await supabase
      .from("events")
      .delete()
      .eq("id", event.id)
      .select("id")
      .maybeSingle();
    if (deleteError) throw new Error(`Nie udało się usunąć wydarzenia: ${deleteError.message}`);
    if (!deletedEvent) throw new Error("Wydarzenie nie zostało usunięte.");

    const eventFilePaths = (eventFiles || [])
      .map((row: { file_path?: string | null }) => row.file_path)
      .filter((path: string | null | undefined): path is string => Boolean(path));
    const offerFilePaths = (offerFiles || [])
      .map((row: { generated_pdf_url?: string | null }) => row.generated_pdf_url)
      .filter((path: string | null | undefined): path is string => Boolean(path));

    await Promise.all([
      eventFilePaths.length
        ? supabase.storage.from("event-files").remove(eventFilePaths)
        : Promise.resolve(),
      offerFilePaths.length
        ? supabase.storage.from("generated-offers").remove(offerFilePaths)
        : Promise.resolve(),
    ]);

    return json({ success: true, eventId: event.id, eventName: event.name });
  } catch (error) {
    console.error("[delete-event-safe]", error);
    return json(
      { error: error instanceof Error ? error.message : "Nie udało się usunąć wydarzenia." },
      400,
    );
  }
});
