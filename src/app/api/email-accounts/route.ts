import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use raw SQL query as workaround for schema cache issue
    const { data, error } = await supabase.rpc('add_email_account', {
      p_employee_id: body.employee_id,
      p_account_name: body.account_name,
      p_from_name: body.from_name,
      p_email_address: body.email_address,
      p_imap_host: body.imap_host,
      p_imap_port: body.imap_port,
      p_imap_username: body.imap_username,
      p_imap_password: body.imap_password,
      p_imap_use_ssl: body.imap_use_ssl,
      p_smtp_host: body.smtp_host,
      p_smtp_port: body.smtp_port,
      p_smtp_username: body.smtp_username,
      p_smtp_password: body.smtp_password,
      p_smtp_use_tls: body.smtp_use_tls,
      p_signature: body.signature || null,
      p_is_default: body.is_default || false,
      p_is_active: body.is_active !== false
    });

    if (error) {
      console.error('Error adding email account:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
