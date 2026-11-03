import { NextResponse } from 'next/server';
import { getTeamMembers } from '@/lib/Pages/Home/getTeamMembers';

// Re-read publication settings on each request. Query parameters (including
// legacy ?all=true) must never expand this public endpoint's employee scope.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getTeamMembers(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Database details are logged on the server by getTeamMembers, not exposed publicly.
    return NextResponse.json({ error: 'Nie udało się pobrać zespołu.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

// Read-only endpoint. Employee edits remain protected by CRM permissions and RLS.
