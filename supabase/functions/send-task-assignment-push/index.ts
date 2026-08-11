import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

type TaskRow = {
  id: string;
  title: string;
  created_by: string | null;
};

type AssignmentRow = {
  id: string;
  task_id: string;
  employee_id: string;
  assigned_by: string | null;
  tasks: TaskRow | TaskRow[] | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") ?? "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    const callerId = userData.user?.id;
    if (userError || !callerId) return json({ error: "Invalid authorization" }, 401);

    const payload = await req.json() as { assignment_id?: string };
    if (!payload.assignment_id) return json({ error: "assignment_id is required" }, 400);

    const [{ data: assignmentData, error: assignmentError }, { data: caller, error: callerError }] =
      await Promise.all([
        supabase
          .from("task_assignees")
          .select("id, task_id, employee_id, assigned_by, tasks!inner(id, title, created_by)")
          .eq("id", payload.assignment_id)
          .maybeSingle(),
        supabase
          .from("employees")
          .select("id, name, surname, nickname, role, access_level, permissions, is_active")
          .eq("id", callerId)
          .maybeSingle(),
      ]);

    if (assignmentError || !assignmentData) return json({ error: "Assignment not found" }, 404);
    if (callerError || !caller?.is_active) return json({ error: "Active employee required" }, 403);

    const assignment = assignmentData as unknown as AssignmentRow;
    const task = Array.isArray(assignment.tasks) ? assignment.tasks[0] : assignment.tasks;
    if (!task) return json({ error: "Task not found" }, 404);

    const permissions = Array.isArray(caller.permissions) ? caller.permissions : [];
    const canSend =
      assignment.assigned_by === callerId ||
      task.created_by === callerId ||
      caller.role === "admin" ||
      caller.access_level === "admin" ||
      permissions.includes("tasks_manage");

    if (!canSend) return json({ error: "Not allowed to notify this assignment" }, 403);
    if (assignment.employee_id === callerId) {
      return json({ success: true, sent: 0, reason: "self_assignment" });
    }

    const { data: notifications, error: notificationsError } = await supabase
      .from("notifications")
      .select("id")
      .eq("related_entity_type", "task")
      .eq("related_entity_id", task.id)
      .contains("metadata", { kind: "task_assignment", task_assignment_id: assignment.id })
      .order("created_at", { ascending: false })
      .limit(1);

    if (notificationsError) {
      throw new Error(`Notification query failed: ${notificationsError.message}`);
    }

    const notificationId = notifications?.[0]?.id;
    if (!notificationId) return json({ error: "Assignment notification not found" }, 404);

    const { data: recipient, error: recipientError } = await supabase
      .from("notification_recipients")
      .select("id, notification_id, user_id, is_read")
      .eq("notification_id", notificationId)
      .eq("user_id", assignment.employee_id)
      .maybeSingle();

    if (recipientError || !recipient) {
      return json({ error: "Assignment notification recipient not found" }, 404);
    }

    const pushResponse = await fetch(
      `${supabaseUrl}/functions/v1/send-crm-notification-push`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
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

    const result = await pushResponse.json();
    if (!pushResponse.ok) {
      throw new Error(result?.error || `CRM push returned ${pushResponse.status}`);
    }

    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[task-assignment-push]", message);
    return json({ error: message }, 500);
  }
});
