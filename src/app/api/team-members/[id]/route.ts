import { NextResponse } from 'next/server';

/**
 * This endpoint is deprecated and read-only.
 * To manage employees (team members), use the CRM at /crm/employees
 *
 * The /api/team-members endpoint only serves public team member data
 * for display on the /zespol page.
 */

export async function PUT() {
  return NextResponse.json({
    error: 'This endpoint is deprecated. Please use /crm/employees to manage team members.'
  }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({
    error: 'This endpoint is deprecated. Please use /crm/employees to manage team members.'
  }, { status: 410 });
}
