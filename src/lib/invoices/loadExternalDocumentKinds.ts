/** Enrich RPC results without changing their financial matching contract. */
export async function loadExternalDocumentKinds(
  supabase: any,
  documentIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(documentIds.filter(Boolean))];
  const kinds = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from('external_invoices')
      .select('id,document_kind')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    for (const document of data || []) {
      kinds.set(document.id, document.document_kind || 'invoice');
    }
  }
  return kinds;
}
