
export async function salesDeliveryActor(req: Request, body: any, service: any, functionName: string) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Wymagane logowanie');
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const id = body._scheduledDispatch?.scheduledEmailId;
    if (!id) throw new Error('Brak zlecenia wysyłki');
    const { data: job, error } = await service.from('scheduled_emails').select('created_by,status,function_name').eq('id', id).single();
    if (error || job.status !== 'processing' || job.function_name !== functionName) throw new Error('Nieprawidłowe zlecenie wysyłki');
    return { userId: job.created_by, scheduled: true, deliveryKey: `scheduled:${id}` };
  }
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error('Sesja wygasła');
  return { userId: data.user.id, scheduled: false, deliveryKey: null };
}
export async function assertSalesDocumentPermission(service: any, kind: string, id: string, userId: string) {
  const { data, error } = await service.rpc('sales_actor_can_manage', { p_kind: kind, p_document: id, p_user: userId });
  if (error || !data) throw new Error('Brak uprawnień do dokumentu');
}
export async function assertSalesMailbox(service: any, accountId: string, userId: string) {
  const { data: employee } = await service.from('employees').select('id,permissions,role,access_level').or(`id.eq.${userId},auth_user_id.eq.${userId}`).eq('is_active', true).limit(1).single();
  const { data: account } = await service.from('employee_email_accounts').select('employee_id,account_type,is_active').eq('id', accountId).single();
  if (!employee || !account?.is_active || account.account_type === 'system') throw new Error('Wybierz aktywną skrzynkę pracownika');
  const { data: assignment } = await service.from('employee_email_account_assignments').select('id').eq('email_account_id', accountId).eq('employee_id', employee.id).maybeSingle();
  if (account.employee_id !== employee.id && !assignment && !employee.permissions?.includes('admin') && employee.role !== 'admin' && employee.access_level !== 'admin') throw new Error('Brak dostępu do skrzynki');
  return employee.id;
}
