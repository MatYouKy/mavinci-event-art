import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const REQUIRED_FIELDS = [
  "source_id",
  "event_type",
  "title",
  "external_event_id",
] as const;
const VALID_PRIORITIES = ["low", "normal", "high", "critical"];
const WEDDING_CARD_FIELDS: Record<string, string> = {
  guest_count: "technical",
  ceremony: "technical",
  venue_arrival_time: "technical",
  venue_access: "technical",
  hot_vodka: "technical",
  first_dance: "technical",
  special_toasts: "technical",
  cake_time: "cake",
  cake_presentation: "cake",
  cake_location: "cake",
  parents_thanks_enabled: "parents_thanks",
  parents_thanks_recipients: "parents_thanks",
  parents_thanks_plan: "parents_thanks",
  oczepiny_enabled: "oczepiny",
  oczepiny_order: "oczepiny",
  oczepiny_notes: "oczepiny",
  spotify_playlist_url: "music",
  youtube_playlist_url: "music",
  general_notes: "notes",
};
const WEDDING_PERSON_SIDES = ["bride", "groom", "shared"];
const WEDDING_PERSON_ROLES = [
  "bride", "groom", "witness", "mother", "father", "godparent", "guardian",
  "subcontractor", "venue_contact", "other",
];
const WEDDING_SCHEDULE_CATEGORIES = [
  "preparation", "ceremony", "arrival", "meal", "first_dance", "cake",
  "parents_thanks", "oczepiny", "attraction", "ending", "other",
];

const PRIORITY_TO_NOTIFICATION_TYPE: Record<string, string> = {
  low: "info",
  normal: "info",
  high: "warning",
  critical: "error",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method === "GET") {
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      const apiKey = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";
      const url = new URL(req.url);
      const sourceSlug = url.searchParams.get("source_id")?.trim() ?? "";
      const resource = url.searchParams.get("resource")?.trim() ?? "";

      if (!apiKey) {
        return jsonResponse({ error: "Missing API key in Authorization header" }, 401);
      }
      if (!sourceSlug) {
        return jsonResponse({ error: "Missing source_id" }, 400);
      }
      if (!["weddings", "wedding-card"].includes(resource)) {
        return jsonResponse({ error: "Unsupported resource" }, 400);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: source, error: sourceError } = await supabase
        .from("webhook_sources")
        .select("id, slug, api_key_hash, is_active")
        .eq("slug", sourceSlug)
        .maybeSingle();

      if (sourceError || !source) {
        return jsonResponse({ error: "Unknown source" }, 401);
      }
      if (!source.is_active) {
        return jsonResponse({ error: "Source is disabled" }, 403);
      }

      const incomingHash = await sha256Hex(apiKey);
      if (incomingHash !== source.api_key_hash) {
        return jsonResponse({ error: "Invalid API key" }, 401);
      }

      if (resource === "wedding-card") {
        const eventId = url.searchParams.get("event_id")?.trim() ?? "";
        if (!eventId) {
          return jsonResponse({ error: "Missing event_id" }, 400);
        }

        const { data: event, error: eventError } = await supabase
          .from("events")
          .select(`
            id,
            name,
            description,
            event_date,
            event_end_date,
            status,
            event_categories!inner(name),
            locations(name, formatted_address, address, city, postal_code),
            organizations(name, alias),
            contacts(first_name, last_name)
          `)
          .eq("id", eventId)
          .ilike("event_categories.name", "wesele")
          .maybeSingle();

        if (eventError) {
          console.error("Fetch wedding event failed:", eventError);
          return jsonResponse({ error: "Failed to fetch wedding event" }, 500);
        }
        if (!event) {
          return jsonResponse({ error: "Wedding event not found" }, 404);
        }

        const { data: card, error: cardError } = await supabase
          .from("wedding_cards")
          .select("id,status,progress,version,submitted_at,approved_at,updated_at")
          .eq("event_id", eventId)
          .maybeSingle();

        if (cardError) {
          console.error("Fetch wedding card failed:", cardError);
          return jsonResponse({ error: "Failed to fetch wedding card" }, 500);
        }

        if (!card) {
          return jsonResponse({
            event,
            card: null,
            answers: [],
            people: [],
            schedule: [],
            tracks: [],
            attractions: [],
          }, 200);
        }

        const [
          answersResult,
          peopleResult,
          scheduleResult,
          tracksResult,
          attractionsResult,
        ] = await Promise.all([
          supabase
            .from("wedding_card_answers")
            .select("section,field_key,value,updated_at")
            .eq("wedding_card_id", card.id),
          supabase
            .from("wedding_card_people")
            .select("id,side,role,first_name,last_name,phone,email,notes,sort_order")
            .eq("wedding_card_id", card.id)
            .order("side")
            .order("sort_order"),
          supabase
            .from("wedding_schedule_items")
            .select("id,title,scheduled_at,category,location,responsible_person,notes,is_confirmed,sort_order")
            .eq("wedding_card_id", card.id)
            .order("scheduled_at", { ascending: true, nullsFirst: false })
            .order("sort_order"),
          supabase
            .from("wedding_music_tracks")
            .select("id,list_type,title,artist,url,notes,sort_order")
            .eq("wedding_card_id", card.id)
            .order("sort_order"),
          supabase
            .from("wedding_attraction_choices")
            .select("id,attraction_key,attraction_name,choice,notes")
            .eq("wedding_card_id", card.id)
            .order("attraction_name"),
        ]);

        if (
          answersResult.error || peopleResult.error || scheduleResult.error ||
          tracksResult.error || attractionsResult.error
        ) {
          console.error("Fetch wedding card content failed:", {
            answers: answersResult.error,
            people: peopleResult.error,
            schedule: scheduleResult.error,
            tracks: tracksResult.error,
            attractions: attractionsResult.error,
          });
          return jsonResponse({ error: "Failed to fetch wedding card content" }, 500);
        }

        return jsonResponse({
          event,
          card,
          answers: answersResult.data ?? [],
          people: peopleResult.data ?? [],
          schedule: scheduleResult.data ?? [],
          tracks: tracksResult.data ?? [],
          attractions: attractionsResult.data ?? [],
        }, 200);
      }

      const { data: events, error: eventsError } = await supabase
        .from("events")
        .select(`
          id,
          name,
          description,
          event_date,
          event_end_date,
          status,
          client_type,
          event_categories!inner(name),
          locations(name, formatted_address, address, city, postal_code),
          organizations(name, alias, email, phone),
          contacts(first_name, last_name, email, phone, business_phone)
        `)
        .ilike("event_categories.name", "wesele")
        .order("event_date", { ascending: true });

      if (eventsError) {
        console.error("Fetch wedding events failed:", eventsError);
        return jsonResponse({ error: "Failed to fetch wedding events" }, 500);
      }

      return jsonResponse(
        {
          events: events ?? [],
          fetched_at: new Date().toISOString(),
        },
        200,
      );
    } catch (error) {
      console.error("Wedding events endpoint error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }

  if (req.method === "PUT") {
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      const apiKey = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";
      const url = new URL(req.url);
      const sourceSlug = url.searchParams.get("source_id")?.trim() ?? "";
      const resource = url.searchParams.get("resource")?.trim() ?? "";
      const eventId = url.searchParams.get("event_id")?.trim() ?? "";

      if (!apiKey) return jsonResponse({ error: "Missing API key" }, 401);
      if (!sourceSlug || resource !== "wedding-card" || !eventId) {
        return jsonResponse({ error: "Invalid wedding card request" }, 400);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: source } = await supabase
        .from("webhook_sources")
        .select("api_key_hash,is_active")
        .eq("slug", sourceSlug)
        .maybeSingle();

      if (!source || (await sha256Hex(apiKey)) !== source.api_key_hash) {
        return jsonResponse({ error: "Invalid API key" }, 401);
      }
      if (!source.is_active) return jsonResponse({ error: "Source is disabled" }, 403);

      const { data: weddingEvent } = await supabase
        .from("events")
        .select("id,event_categories!inner(name)")
        .eq("id", eventId)
        .ilike("event_categories.name", "wesele")
        .maybeSingle();
      if (!weddingEvent) return jsonResponse({ error: "Wedding event not found" }, 404);

      const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
      const rawAnswers = Array.isArray(payload?.answers) ? payload.answers : null;
      if (!rawAnswers || rawAnswers.length > Object.keys(WEDDING_CARD_FIELDS).length) {
        return jsonResponse({ error: "Invalid answers payload" }, 400);
      }

      const answers = rawAnswers.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const fieldKey = typeof raw.field_key === "string" ? raw.field_key : "";
        const section = WEDDING_CARD_FIELDS[fieldKey];
        if (!section) return [];
        return [{ field_key: fieldKey, section, value: raw.value ?? null }];
      });
      if (answers.length !== rawAnswers.length) {
        return jsonResponse({ error: "Unsupported wedding card field" }, 422);
      }

      const rawPeople = Array.isArray(payload?.people) ? payload.people : null;
      const people = rawPeople?.flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const side = typeof raw.side === "string" ? raw.side : "";
        const role = typeof raw.role === "string" ? raw.role : "";
        const firstName = typeof raw.first_name === "string" ? raw.first_name.trim() : "";
        if (
          !firstName || !WEDDING_PERSON_SIDES.includes(side) ||
          !WEDDING_PERSON_ROLES.includes(role)
        ) return [];
        return [{
          side,
          role,
          first_name: firstName.slice(0, 120),
          last_name: typeof raw.last_name === "string" ? raw.last_name.trim().slice(0, 120) : null,
          phone: typeof raw.phone === "string" ? raw.phone.trim().slice(0, 50) : null,
          email: typeof raw.email === "string" ? raw.email.trim().slice(0, 255) : null,
          notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : null,
          sort_order: index,
        }];
      });
      if (rawPeople && (rawPeople.length > 30 || people?.length !== rawPeople.length)) {
        return jsonResponse({ error: "Invalid wedding people payload" }, 422);
      }

      const rawSchedule = Array.isArray(payload?.schedule) ? payload.schedule : null;
      const schedule = rawSchedule?.flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        const category = typeof raw.category === "string" ? raw.category : "other";
        const scheduledAt = typeof raw.scheduled_at === "string" && raw.scheduled_at
          ? raw.scheduled_at
          : null;
        if (
          !title || !WEDDING_SCHEDULE_CATEGORIES.includes(category) ||
          (scheduledAt && Number.isNaN(Date.parse(scheduledAt)))
        ) return [];
        return [{
          title: title.slice(0, 300),
          scheduled_at: scheduledAt,
          category,
          location: typeof raw.location === "string" ? raw.location.trim().slice(0, 300) : null,
          responsible_person: typeof raw.responsible_person === "string"
            ? raw.responsible_person.trim().slice(0, 200)
            : null,
          notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : null,
          is_confirmed: raw.is_confirmed === true,
          sort_order: index,
        }];
      });
      if (rawSchedule && (rawSchedule.length > 100 || schedule?.length !== rawSchedule.length)) {
        return jsonResponse({ error: "Invalid wedding schedule payload" }, 422);
      }

      const rawTracks = Array.isArray(payload?.tracks) ? payload.tracks : null;
      const tracks = rawTracks?.flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        const listType = typeof raw.list_type === "string" ? raw.list_type : "";
        if (!title || !["play", "do_not_play", "special"].includes(listType)) return [];
        return [{ title: title.slice(0, 300), list_type: listType, artist: typeof raw.artist === "string" ? raw.artist.trim().slice(0, 300) : null, url: typeof raw.url === "string" ? raw.url.trim().slice(0, 1000) : null, notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : null, sort_order: index }];
      });
      if (rawTracks && (rawTracks.length > 200 || tracks?.length !== rawTracks.length)) return jsonResponse({ error: "Invalid music payload" }, 422);

      const rawAttractions = Array.isArray(payload?.attractions) ? payload.attractions : null;
      const attractions = rawAttractions?.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const name = typeof raw.attraction_name === "string" ? raw.attraction_name.trim() : "";
        const choice = typeof raw.choice === "string" ? raw.choice : "undecided";
        if (!name || !["undecided", "interested", "selected", "rejected"].includes(choice)) return [];
        const key = typeof raw.attraction_key === "string" && raw.attraction_key.trim() ? raw.attraction_key.trim() : crypto.randomUUID();
        return [{ attraction_key: key.slice(0, 300), attraction_name: name.slice(0, 300), choice, notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : null }];
      });
      if (rawAttractions && (rawAttractions.length > 100 || attractions?.length !== rawAttractions.length)) return jsonResponse({ error: "Invalid attractions payload" }, 422);

      const { data: existingCard } = await supabase
        .from("wedding_cards")
        .select("id,status")
        .eq("event_id", eventId)
        .maybeSingle();

      let cardId = existingCard?.id as string | undefined;
      if (!cardId) {
        const { data: createdCard, error: createError } = await supabase
          .from("wedding_cards")
          .insert({ event_id: eventId, status: "in_progress" })
          .select("id")
          .single();
        if (createError || !createdCard) {
          console.error("Create wedding card failed:", createError);
          return jsonResponse({ error: "Failed to create wedding card" }, 500);
        }
        cardId = createdCard.id;
      }

      if (answers.length > 0) {
        const { error: upsertError } = await supabase
          .from("wedding_card_answers")
          .upsert(
            answers.map((answer) => ({
              wedding_card_id: cardId,
              ...answer,
              source: "event_rulers",
              updated_by: null,
            })),
            { onConflict: "wedding_card_id,field_key" },
          );
        if (upsertError) {
          console.error("Save wedding card answers failed:", upsertError);
          return jsonResponse({ error: "Failed to save wedding card" }, 500);
        }
      }

      if (people) {
        const { error: deletePeopleError } = await supabase
          .from("wedding_card_people")
          .delete()
          .eq("wedding_card_id", cardId);
        if (deletePeopleError) {
          return jsonResponse({ error: "Failed to update wedding people" }, 500);
        }
        if (people.length > 0) {
          const { error: insertPeopleError } = await supabase
            .from("wedding_card_people")
            .insert(people.map((person) => ({
              wedding_card_id: cardId,
              ...person,
              source: "event_rulers",
            })));
          if (insertPeopleError) {
            console.error("Save wedding people failed:", insertPeopleError);
            return jsonResponse({ error: "Failed to save wedding people" }, 500);
          }
        }
      }

      if (schedule) {
        const { error: deleteScheduleError } = await supabase
          .from("wedding_schedule_items")
          .delete()
          .eq("wedding_card_id", cardId);
        if (deleteScheduleError) {
          return jsonResponse({ error: "Failed to update wedding schedule" }, 500);
        }
        if (schedule.length > 0) {
          const { error: insertScheduleError } = await supabase
            .from("wedding_schedule_items")
            .insert(schedule.map((item) => ({
              wedding_card_id: cardId,
              ...item,
              source: "event_rulers",
            })));
          if (insertScheduleError) {
            console.error("Save wedding schedule failed:", insertScheduleError);
            return jsonResponse({ error: "Failed to save wedding schedule" }, 500);
          }
        }
      }

      if (tracks) {
        const deleted = await supabase.from("wedding_music_tracks").delete().eq("wedding_card_id", cardId);
        if (deleted.error) return jsonResponse({ error: "Failed to update music" }, 500);
        if (tracks.length) {
          const inserted = await supabase.from("wedding_music_tracks").insert(tracks.map((track) => ({ wedding_card_id: cardId, ...track, source: "event_rulers" })));
          if (inserted.error) return jsonResponse({ error: "Failed to save music" }, 500);
        }
      }

      if (attractions) {
        const deleted = await supabase.from("wedding_attraction_choices").delete().eq("wedding_card_id", cardId);
        if (deleted.error) return jsonResponse({ error: "Failed to update attractions" }, 500);
        if (attractions.length) {
          const inserted = await supabase.from("wedding_attraction_choices").insert(attractions.map((attraction) => ({ wedding_card_id: cardId, ...attraction, source: "event_rulers" })));
          if (inserted.error) return jsonResponse({ error: "Failed to save attractions" }, 500);
        }
      }

      const filledCount = answers.filter((answer) => {
        const value = answer.value;
        if (value === null || value === undefined || value === "") return false;
        if (Array.isArray(value)) return value.length > 0;
        return true;
      }).length;
      const essentialPeopleCount = people
        ? people.filter((person) => ["bride", "groom", "witness", "mother", "father"].includes(person.role)).length
        : 0;
      const progress = Math.min(100, Math.round(
        ((filledCount + Math.min(essentialPeopleCount, 8)) /
          (Object.keys(WEDDING_CARD_FIELDS).length + 8)) * 100,
      ));
      const submit = payload?.submit === true;

      const { data: updatedCard, error: updateError } = await supabase
        .from("wedding_cards")
        .update({
          progress,
          status: submit ? "submitted" : "in_progress",
          submitted_at: submit ? new Date().toISOString() : null,
          last_portal_sync_at: new Date().toISOString(),
        })
        .eq("id", cardId)
        .select("id,status,progress,updated_at")
        .single();

      if (updateError) {
        console.error("Update wedding card state failed:", updateError);
        return jsonResponse({ error: "Failed to update wedding card" }, 500);
      }

      return jsonResponse({ status: "saved", card: updatedCard }, 200);
    } catch (error) {
      console.error("Wedding card update endpoint error:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!apiKey) {
      return jsonResponse({ error: "Missing API key in Authorization header" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const missing = REQUIRED_FIELDS.filter(
      (f) => !payload[f] || typeof payload[f] !== "string" || !(payload[f] as string).trim(),
    );
    if (missing.length > 0) {
      return jsonResponse(
        { error: `Missing required fields: ${missing.join(", ")}` },
        400,
      );
    }

    const sourceSlug = (payload.source_id as string).trim();
    const eventType = (payload.event_type as string).trim();
    const title = (payload.title as string).trim();
    const externalEventId = (payload.external_event_id as string).trim();
    const body = typeof payload.body === "string" ? payload.body.trim() : null;
    const priority =
      typeof payload.priority === "string" &&
      VALID_PRIORITIES.includes(payload.priority)
        ? payload.priority
        : "normal";
    const detailUrl =
      typeof payload.detail_url === "string" ? payload.detail_url.trim() : null;
    const eventTime =
      typeof payload.event_time === "string" ? payload.event_time : null;
    const metadata =
      typeof payload.metadata === "object" && payload.metadata !== null
        ? payload.metadata
        : {};

    if (title.length > 500) {
      return jsonResponse({ error: "Title exceeds 500 characters" }, 400);
    }
    if (externalEventId.length > 255) {
      return jsonResponse({ error: "external_event_id exceeds 255 characters" }, 400);
    }
    if (eventTime && Number.isNaN(Date.parse(eventTime))) {
      return jsonResponse({ error: "event_time must be a valid ISO date" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: source, error: srcErr } = await supabase
      .from("webhook_sources")
      .select("id, name, slug, api_key_hash, is_active, allowed_event_types, default_notify_permissions")
      .eq("slug", sourceSlug)
      .maybeSingle();

    if (srcErr || !source) {
      return jsonResponse({ error: "Unknown source" }, 401);
    }

    if (!source.is_active) {
      return jsonResponse({ error: "Source is disabled" }, 403);
    }

    const incomingHash = await sha256Hex(apiKey);
    if (incomingHash !== source.api_key_hash) {
      return jsonResponse({ error: "Invalid API key" }, 401);
    }

    if (
      source.allowed_event_types &&
      source.allowed_event_types.length > 0 &&
      !source.allowed_event_types.includes(eventType)
    ) {
      return jsonResponse(
        {
          error: `Event type '${eventType}' is not allowed for this source`,
          allowed: source.allowed_event_types,
        },
        422,
      );
    }

    const { data: existing } = await supabase
      .from("inbound_events")
      .select("id, status, created_at")
      .eq("source_id", source.id)
      .eq("external_event_id", externalEventId)
      .maybeSingle();

    if (existing && existing.status !== "failed") {
      return jsonResponse(
        {
          status: "duplicate",
          message: "Event already received",
          event_id: existing.id,
          received_at: existing.created_at,
        },
        200,
      );
    }

    if (existing?.status === "failed") {
      const { error: deleteFailedEventError } = await supabase
        .from("inbound_events")
        .delete()
        .eq("id", existing.id);

      if (deleteFailedEventError) {
        console.error("Failed to prepare webhook retry:", deleteFailedEventError);
        return jsonResponse({ error: "Failed to retry event" }, 500);
      }
    }

    const { data: event, error: insertErr } = await supabase
      .from("inbound_events")
      .insert({
        source_id: source.id,
        external_event_id: externalEventId,
        event_type: eventType,
        title,
        body,
        priority,
        detail_url: detailUrl,
        event_time: eventTime,
        metadata,
        status: "received",
      })
      .select("id")
      .single();

    if (insertErr || !event) {
      console.error("Insert inbound_event failed:", insertErr);
      return jsonResponse({ error: "Failed to store event" }, 500);
    }

    let notificationId: string | null = null;
    let recipientCount = 0;
    try {
      const configuredPermissions = source.default_notify_permissions as string[] | null;
      const requiredPermissions = configuredPermissions && configuredPermissions.length > 0
        ? configuredPermissions
        : ["messages_view", "messages_manage"];

      const [employeesResult, settingsResult, sourceSettingsResult] = await Promise.all([
        supabase
          .from("employees")
          .select("id, role, access_level, permissions")
          .eq("is_active", true),
        supabase
          .from("employee_notification_settings")
          .select("employee_id, webhook_notifications_enabled"),
        supabase
          .from("employee_webhook_notification_settings")
          .select("employee_id, is_enabled")
          .eq("source_id", source.id),
      ]);

      if (employeesResult.error) {
        throw new Error(`Fetch recipients failed: ${employeesResult.error.message}`);
      }
      if (settingsResult.error) {
        throw new Error(`Fetch notification settings failed: ${settingsResult.error.message}`);
      }
      if (sourceSettingsResult.error) {
        throw new Error(`Fetch source settings failed: ${sourceSettingsResult.error.message}`);
      }

      const globalSettings = new Map(
        (settingsResult.data ?? []).map((setting) => [
          setting.employee_id,
          setting.webhook_notifications_enabled,
        ]),
      );
      const perSourceSettings = new Map(
        (sourceSettingsResult.data ?? []).map((setting) => [
          setting.employee_id,
          setting.is_enabled,
        ]),
      );

      const recipients = (employeesResult.data ?? []).filter((employee) => {
        const permissions = (employee.permissions ?? []) as string[];
        const isAdmin = employee.role === "admin" ||
          employee.access_level === "admin" ||
          permissions.includes("admin");
        const hasDataAccess = isAdmin ||
          permissions.includes("webhooks_view") ||
          permissions.includes("webhooks_manage") ||
          permissions.some((permission) => requiredPermissions.includes(permission));

        if (!hasDataAccess) return false;

        // Admins are subscribed by default but may explicitly opt out.
        // Other employees require an explicit global and per-source opt-in.
        const globalEnabled = globalSettings.get(employee.id) ?? isAdmin;
        const sourceEnabled = perSourceSettings.get(employee.id) ?? isAdmin;
        return globalEnabled && sourceEnabled;
      });
      recipientCount = recipients.length;

      if (recipients.length === 0) {
        const { error: processedWithoutRecipientsError } = await supabase
          .from("inbound_events")
          .update({
            status: "processed",
            notification_id: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", event.id);

        if (processedWithoutRecipientsError) {
          throw new Error(
            `Mark event without recipients as processed failed: ${processedWithoutRecipientsError.message}`,
          );
        }

        return jsonResponse(
          {
            status: "accepted",
            event_id: event.id,
            notification_id: null,
            recipients: 0,
          },
          201,
        );
      }

      const notifMessage = body
        ? `${body.slice(0, 300)}${body.length > 300 ? "..." : ""}`
        : `Zdarzenie typu "${eventType}" ze źródła "${source.name}"`;

      const { data: notif, error: notifErr } = await supabase
        .from("notifications")
        .insert({
          title,
          message: notifMessage,
          type: PRIORITY_TO_NOTIFICATION_TYPE[priority] || "info",
          category: "system",
          action_url: `/crm/settings/webhooks`,
          metadata: {
            origin: "webhook",
            inbound_event_id: event.id,
            source_slug: source.slug,
            source_name: source.name,
            event_type: eventType,
            priority,
          },
        })
        .select("id")
        .single();

      if (notifErr || !notif) {
        throw new Error(`Insert notification failed: ${notifErr?.message ?? "unknown error"}`);
      }

      notificationId = notif.id;

      const rows = recipients.map((recipient: { id: string }) => ({
        notification_id: notif.id,
        user_id: recipient.id,
      }));

      const { data: insertedRecipients, error: recipientsError } = await supabase
        .from("notification_recipients")
        .insert(rows)
        .select("id, notification_id, user_id, is_read");

      if (recipientsError) {
        throw new Error(`Insert notification recipients failed: ${recipientsError.message}`);
      }

      const pushResults = await Promise.allSettled(
        (insertedRecipients ?? []).map(async (recipient) => {
          const pushResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-crm-notification-push`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                apikey: serviceKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                type: "INSERT",
                table: "notification_recipients",
                schema: "public",
                record: recipient,
                old_record: null,
              }),
            },
          );

          if (!pushResponse.ok) {
            throw new Error(`Push function returned HTTP ${pushResponse.status}`);
          }
        }),
      );

      const failedPushes = pushResults.filter((result) => result.status === "rejected");
      if (failedPushes.length > 0) {
        console.error(`Push delivery failed for ${failedPushes.length} recipients`);
      }

      const { error: processedError } = await supabase
        .from("inbound_events")
        .update({
          status: "processed",
          notification_id: notificationId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (processedError) {
        throw new Error(`Mark event as processed failed: ${processedError.message}`);
      }
    } catch (notifyErr) {
      console.error("Notification pipeline error:", notifyErr);
      if (notificationId) {
        await supabase.from("notifications").delete().eq("id", notificationId);
        notificationId = null;
      }
      await supabase
        .from("inbound_events")
        .update({ status: "failed" })
        .eq("id", event.id);

      return jsonResponse(
        {
          error: "Event stored but notification delivery failed",
          event_id: event.id,
        },
        500,
      );
    }

    return jsonResponse(
      {
        status: "accepted",
        event_id: event.id,
        notification_id: notificationId,
        recipients: recipientCount,
      },
      201,
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
