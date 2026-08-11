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

    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("employee_id", assignment.employee_id);

    if (tokensError) throw new Error(`Push token query failed: ${tokensError.message}`);
    if (!tokens?.length) return json({ success: true, sent: 0, reason: "no_push_tokens" });

    const actorName =
      [caller.name, caller.surname].filter(Boolean).join(" ").trim() ||
      caller.nickname?.trim() ||
      "Użytkownik";
    const body = `${actorName} przypisał(a) Cię do zadania „${task.title}”.`;

    const messages = tokens.map(({ token }: { token: string }) => ({
      to: token,
      sound: "default",
      title: "Przypisano Cię do zadania",
      body,
      data: {
        type: "task_assignment",
        task_id: task.id,
        entity_type: "task",
        entity_id: task.id,
        category: "tasks",
        action_url: `/crm/tasks/${task.id}`,
        assignment_id: assignment.id,
      },
      priority: "high",
      channelId: "default",
    }));

    const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    if (!expoResponse.ok) {
      throw new Error(`Expo API returned ${expoResponse.status}`);
    }

    const expoResult = await expoResponse.json();
    let sent = 0;
    const invalidTokens: string[] = [];

    for (let index = 0; index < (expoResult.data?.length ?? 0); index += 1) {
      const ticket = expoResult.data[index];
      if (ticket.status === "ok") sent += 1;
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        invalidTokens.push(messages[index].to);
      }
    }

    if (invalidTokens.length) {
      await supabase.from("push_tokens").delete().in("token", invalidTokens);
    }

    return json({ success: true, sent, total_tokens: tokens.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[task-assignment-push]", message);
    return json({ error: message }, 500);
  }
});
