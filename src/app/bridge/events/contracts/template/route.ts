import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpdateContractTemplateBody = {
  eventId?: string;
  templateId?: string;
};

export async function PATCH(request: Request) {
  try {
    const { eventId, templateId } = (await request.json()) as UpdateContractTemplateBody;

    if (!eventId || !templateId) {
      return NextResponse.json(
        { error: 'Brak identyfikatora wydarzenia lub szablonu.' },
        { status: 400 },
      );
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManage, error: permissionError } = await userClient.rpc(
      'can_manage_event_workflows',
      { p_event_id: eventId },
    );
    if (permissionError || !canManage) {
      return NextResponse.json(
        { error: 'Nie masz uprawnień do zmiany szablonu tej umowy.' },
        { status: 403 },
      );
    }

    const { data: eventAccess, error: eventAccessError } = await userClient.from('events').select('id').eq('id', eventId).maybeSingle();
    const { data: contractManage } = await userClient.rpc('crm_contract_permission', { p_action: 'manage' });
    if (eventAccessError || !eventAccess || !contractManage) return NextResponse.json({ error: 'Brak dostępu do umowy wydarzenia.' }, { status: 403 });
    const admin = createSupabaseAdminClient();
    const { data: template, error: templateError } = await admin
      .from('contract_templates')
      .select('id, name, is_active')
      .eq('id', templateId)
      .maybeSingle();

    if (templateError) throw templateError;
    if (!template || template.is_active === false) {
      return NextResponse.json({ error: 'Wybrany szablon nie jest dostępny.' }, { status: 404 });
    }

    const { data: event, error: updateError } = await admin
      .from('events')
      .update({ selected_contract_template_id: templateId })
      .eq('id', eventId)
      .select('id, selected_contract_template_id')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!event || event.selected_contract_template_id !== templateId) {
      return NextResponse.json(
        { error: 'Nie udało się utrwalić wyboru szablonu.' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      eventId: event.id,
      templateId: event.selected_contract_template_id,
      templateName: template.name,
    });
  } catch (error: any) {
    console.error('Contract template update error:', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zmienić szablonu umowy.' },
      { status: 500 },
    );
  }
}
