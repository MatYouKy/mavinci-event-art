import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AssignmentStatus = "pending" | "accepted" | "rejected";

type AssignmentRow = {
  id: string;
  event_id: string;
  status: AssignmentStatus;
  invitation_expires_at: string | null; // timestamptz z Supabase jako string
};

function getOrigin(req: Request) {
  const url = new URL(req.url);

  const proto =
    req.headers.get("x-forwarded-proto") ??
    url.protocol.replace(":", "");

  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    url.host;

  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const origin = getOrigin(req);

  if (!token) return NextResponse.redirect(new URL("/", origin), 302);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.redirect(new URL("/invitation/error?reason=env", origin), 302);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: assignment, error } = await supabase
    .from("employee_assignments")
    .select("id, event_id, status, invitation_expires_at")
    .eq("invitation_token", token)
    .maybeSingle<AssignmentRow>();

  if (error || !assignment) {
    return NextResponse.redirect(new URL("/invitation/error?reason=invalid", origin), 302);
  }

  if (
    assignment.invitation_expires_at &&
    new Date(assignment.invitation_expires_at) < new Date()
  ) {
    return NextResponse.redirect(new URL("/invitation/error?reason=expired", origin), 302);
  }

  if (assignment.status !== "pending") {
    return NextResponse.redirect(
      new URL("/invitation/error?reason=already-responded", origin),
      302
    );
  }

  const { error: updateError } = await supabase
    .from("employee_assignments")
    .update({ status: "accepted" as const, responded_at: new Date().toISOString() })
    .eq("id", assignment.id);

  if (updateError) {
    return NextResponse.redirect(new URL("/invitation/error?reason=update", origin), 302);
  }

  return NextResponse.redirect(new URL(`/crm/events/${assignment.event_id}`, origin), 302);
}