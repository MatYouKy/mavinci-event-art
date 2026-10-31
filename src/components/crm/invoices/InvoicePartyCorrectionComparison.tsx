export type InvoiceComparableParty = {
  name: string;
  nip?: string | null;
  internalId?: string | null;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
};

const text = (value: string | null | undefined) => value?.trim() || '—';
const address = (party: InvoiceComparableParty | null) => party
  ? [party.street, [party.postalCode, party.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

/** Read-only comparison; neither side is refreshed from a current CRM contact. */
export default function InvoicePartyCorrectionComparison({
  beforeBuyer, afterBuyer, beforeRecipient, afterRecipient, printable = false,
}: {
  beforeBuyer: InvoiceComparableParty;
  afterBuyer: InvoiceComparableParty;
  beforeRecipient: InvoiceComparableParty | null;
  afterRecipient: InvoiceComparableParty | null;
  printable?: boolean;
}) {
  const groups = [
    { name: 'Nabywca', rows: [
      ['Nazwa', beforeBuyer.name, afterBuyer.name],
      ['NIP', beforeBuyer.nip, afterBuyer.nip],
      ['Adres', address(beforeBuyer), address(afterBuyer)],
      ['Kraj', beforeBuyer.countryCode, afterBuyer.countryCode],
    ] },
    { name: 'Odbiorca', rows: [
      ['Nazwa', beforeRecipient?.name || 'Bez osobnego odbiorcy', afterRecipient?.name || 'Bez osobnego odbiorcy'],
      ['NIP', beforeRecipient?.nip, afterRecipient?.nip],
      ['IDWew KSeF', beforeRecipient?.internalId, afterRecipient?.internalId],
      ['Adres', address(beforeRecipient), address(afterRecipient)],
      ['Kraj', beforeRecipient?.countryCode, afterRecipient?.countryCode],
    ] },
  ];

  return <section className={printable ? 'my-5 text-sm text-gray-900' : 'rounded-xl bg-black/15 p-4 text-sm text-[#e5e4e2]'}>
    <h3 className={printable ? 'mb-3 font-semibold' : 'mb-3 font-medium text-[#d3bb73]'}>Korekta danych — przed i po</h3>
    <p className={printable ? 'mb-3 text-xs text-gray-600' : 'mb-3 text-xs text-[#e5e4e2]/60'}>Korekta dotyczy danych stron. Nie zmienia wartości faktury pierwotnej ani kwoty do zapłaty.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px] table-fixed border-collapse text-left text-xs">
        <thead className={printable ? 'bg-gray-100' : 'bg-white/[0.04]'}><tr>
          <th className="w-[22%] px-3 py-2 font-medium">Pole</th>
          <th className="w-[39%] px-3 py-2 font-medium">Przed korektą</th>
          <th className="w-[39%] px-3 py-2 font-medium">Po korekcie</th>
        </tr></thead>
        {groups.map((group) => <tbody key={group.name}>
          <tr><th colSpan={3} className={`px-3 pb-2 pt-4 font-semibold ${printable ? 'text-gray-900' : 'text-[#d3bb73]'}`}>{group.name}</th></tr>
          {group.rows.map(([label, before, after]) => <tr key={label} className={printable ? 'border-b border-gray-200' : 'border-b border-white/[0.05]'}>
            <th className={`px-3 py-2 align-top font-normal ${printable ? 'text-gray-600' : 'text-[#e5e4e2]/60'}`}>{label}</th>
            <td className="break-words px-3 py-2 align-top">{text(before)}</td>
            <td className={`break-words px-3 py-2 align-top ${text(before) !== text(after) ? printable ? 'bg-gray-50 font-semibold' : 'bg-[#d3bb73]/5 font-medium text-[#d3bb73]' : ''}`}>{text(after)}</td>
          </tr>)}
        </tbody>)}
      </table>
    </div>
  </section>;
}
