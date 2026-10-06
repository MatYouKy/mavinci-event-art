'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { subcontractorProfileSchema, settlementLabels } from './profileValidation';
import { addressTypes, emptyAddress, formatProfileAddress, matchesProfileAddress } from './profileAddress';
import { usePersonnelAccess } from '@/components/crm/personnel/usePersonnelAccess';
const input = 'mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2';
export default function SubcontractorProfileForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: any;
  onSaved: (v: any) => void;
  onCancel?: () => void;
}) {
  const access = usePersonnelAccess();
  const saveLock = useRef(false);
  const [form, setForm] = useState({
    company_name: initial?.company_name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    nip: initial?.nip || '',
    address: initial?.address || '',
    default_settlement_type: initial?.default_settlement_type || '',
    notes: initial?.notes || '',
    personnel_identifier: '',
    personnel_address: '',
    personnel_bank_account: '',
    personnel_address_parts: { ...emptyAddress },
  });
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false);
  const [loadingPersonnel,setLoadingPersonnel] = useState(Boolean(initial?.id));
  const [personnelLoadError,setPersonnelLoadError] = useState('');
  useEffect(() => {
    let live=true;
    if(!initial?.id) {setLoadingPersonnel(false);return;}
    if(access.loading) return;
    if(!access.view) {setLoadingPersonnel(false);return;}
    setLoadingPersonnel(true);
    supabase.from('personnel_people').select('identifier,address,bank_account,address_parts').eq('subcontractor_id',initial.id).maybeSingle().then(({data,error})=>{
      if(!live)return;
      if(error)setPersonnelLoadError('Nie udało się pobrać danych do umowy. Odśwież formularz przed zapisem.');
      else setForm(current=>({...current,personnel_identifier:data?.identifier||'',personnel_address:data?.address||'',personnel_address_parts:data?.address_parts && matchesProfileAddress({...emptyAddress,...data.address_parts},data.address) ? {...emptyAddress,...data.address_parts} : {...emptyAddress},personnel_bank_account:data?.bank_account||''}));
      setLoadingPersonnel(false);
    });
    return ()=>{live=false;};
  },[initial?.id,access.loading,access.view]);
  const invoice = form.default_settlement_type.startsWith('invoice');
  const mandate = form.default_settlement_type === 'civil_contract';
  async function validate(next: typeof form) {
    try {
      await subcontractorProfileSchema.validate(next, { abortEarly: false });
      setErrors({});
      return true;
    } catch (e: any) {
      const result: Record<string, string> = {};
      for (const issue of e.inner || [])
        if (issue.path && !result[issue.path]) result[issue.path] = issue.message;
      setErrors(result);
      return false;
    }
  }
  const change = (key: keyof typeof form, value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (submitted) void validate(next);
  };
  const changeAddress = (key: keyof typeof emptyAddress, value: string) => {
    const parts = { ...form.personnel_address_parts, [key]: value };
    const next = { ...form, personnel_address_parts: parts, personnel_address: formatProfileAddress(parts) };
    setForm(next);
    if (submitted) void validate(next);
  };
  return (
    <form
      noValidate
      className="space-y-4 rounded-xl bg-white/5 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saveLock.current || busy || (mandate && (loadingPersonnel || personnelLoadError))) return;
        saveLock.current = true;
        setSubmitted(true);
        if (!(await validate(form))) { saveLock.current=false; return; }
        if (mandate && !access.manage) {
          saveLock.current=false;
          setErrors({
            form: 'Do przygotowania umowy zlecenia potrzebujesz uprawnień do umów i wynagrodzeń.',
          });
          return;
        }
        setBusy(true);
        try {
          const payload = {
            company_name: form.company_name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            nip: invoice ? form.nip.replace(/[\s-]/g, '') : null,
            ...(!mandate ? {address: form.address.trim() || null} : {}),
            default_settlement_type: form.default_settlement_type,
            entity_type: invoice ? 'company' : 'individual',
            is_registered_business: invoice,
            preferred_payment_method: form.default_settlement_type === 'cash' ? 'cash' : 'transfer',
            requires_contract: mandate,
            notes: form.notes.trim() || null,
            ...(!initial ? { status: mandate ? 'inactive' : 'active' } : {}),
          };
          const result = mandate ? await supabase.rpc('save_subcontractor_personnel_profile', {
            p_id: initial?.id || null, p_profile: {...payload, personnel_address_parts: matchesProfileAddress(form.personnel_address_parts, form.personnel_address) ? form.personnel_address_parts : null},
            p_identifier: form.personnel_identifier.replace(/\s/g,''),
            p_address: form.personnel_address.trim(),
            p_bank_account: form.personnel_bank_account.replace(/\s/g,'').toUpperCase(),
          }) : initial
            ? await supabase
                .from('subcontractors')
                .update(payload)
                .eq('id', initial.id)
                .select('*')
                .single()
            : await supabase.from('subcontractors').insert(payload).select('*').single();
          if (result.error) throw result.error;
          onSaved(result.data);
        } catch (e: any) {
          setErrors({ form: e.message || 'Nie udało się zapisać podwykonawcy.' });
        } finally {
          saveLock.current=false;
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg uppercase">
        {initial ? 'Dane i rozliczenie podwykonawcy' : 'Nowy podwykonawca'}
      </h2>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          Forma rozliczenia *
          <select
            className={input}
            value={form.default_settlement_type}
            onChange={(e) => change('default_settlement_type', e.target.value)}
            aria-invalid={!!errors.default_settlement_type}
          >
            <option value="">Wybierz…</option>
            {Object.entries(settlementLabels)
              .filter(([k]) => k !== 'other')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
          {errors.default_settlement_type && (
            <span className="text-sm text-red-300">{errors.default_settlement_type}</span>
          )}
        </label>
        {(
          [
            ['company_name', invoice ? 'Nazwa firmy *' : 'Imię i nazwisko / nazwa *'],
            ['phone', 'Telefon'],
            ['email', 'E-mail'],
            ...(invoice
              ? [
                  ['nip', 'NIP *'],
                  ['address', 'Adres firmy'],
                ]
              : []),
          ] as [Exclude<keyof typeof form, 'personnel_address_parts'>, string][]
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              className={`${input} ${errors[key] ? '!border-red-400/70' : ''}`}
              value={form[key]}
              type={key === 'email' ? 'email' : 'text'}
              onChange={(e) => change(key, e.target.value)}
              aria-invalid={!!errors[key]}
              aria-describedby={errors[key] ? `sub-error-${key}` : undefined}
            />
            {errors[key] && (
              <span id={`sub-error-${key}`} role="alert" className="text-sm text-red-300">
                {errors[key]}
              </span>
            )}
          </label>
        ))}
        {mandate && <div className="sm:col-span-2 space-y-3 rounded-xl bg-white/5 p-4">
          <h3 className="text-[#d3bb73]">Dane do umowy zlecenia</h3>
          {loadingPersonnel ? <p>Ładowanie danych do umowy…</p> : !access.view ? <p>Dane dostępne dla osób z uprawnieniami do umów i wynagrodzeń.</p> : personnelLoadError ? <p role="alert" className="text-red-300">{personnelLoadError}</p> : <div className="grid gap-3 sm:grid-cols-2">
            {([['personnel_identifier','PESEL'],['personnel_bank_account','Numer konta (NRB / IBAN)']] as const).map(([key,label])=><label key={key}>{label}
              <input value={form[key]} disabled={!access.manage} autoComplete="off" inputMode={key==='personnel_identifier'?'numeric':'text'} onChange={e=>change(key,e.target.value)} className={`${input} ${errors[key]?'!border-red-400/70':''}`} aria-invalid={!!errors[key]}/>
              {errors[key]&&<span role="alert" className="text-sm text-red-300">{errors[key]}</span>}
            </label>)}
            <h4 className="sm:col-span-2 text-[#d3bb73]">Adres zamieszkania</h4>
            {form.personnel_address && !formatProfileAddress(form.personnel_address_parts) && <p className="sm:col-span-2 text-sm opacity-75">Dotychczasowy adres: {form.personnel_address}. Pozostanie zapisany, dopóki nie uzupełnisz poniższych pól.</p>}
            <label>Typ adresu
              <select className={input} disabled={!access.manage} value={form.personnel_address_parts.type} onChange={e=>changeAddress('type',e.target.value)}>
                {Object.entries(addressTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {([['name','Nazwa ulicy / placu / wsi'],['house','Numer domu'],['apartment','Numer mieszkania'],['postal_code','Kod pocztowy'],['city','Miejscowość'],['country','Kraj']] as const).map(([key,label])=>{
              const errorKey=`personnel_address_parts.${key}`;
              return <label key={key}>{label}
                <input className={`${input} ${errors[errorKey]?'!border-red-400/70':''}`} disabled={!access.manage} value={form.personnel_address_parts[key]} onChange={e=>changeAddress(key,e.target.value)} aria-invalid={!!errors[errorKey]} aria-describedby={errors[errorKey]?`address-error-${key}`:undefined}/>
                {errors[errorKey]&&<span id={`address-error-${key}`} role="alert" className="text-sm text-red-300">{errors[errorKey]}</span>}
              </label>;
            })}
            {errors.personnel_address&&<span role="alert" className="sm:col-span-2 text-sm text-red-300">{errors.personnel_address}</span>}

          </div>}
          <p className="text-xs opacity-65">Dane podstawią się do nowej umowy. Możesz uzupełniać je etapami; zapisane umowy zachowują swoją treść.</p>
        </div>}
        <label className="sm:col-span-2">
          Notatki
          <textarea
            className={input}
            value={form.notes}
            onChange={(e) => change('notes', e.target.value)}
          />
        </label>
      </fieldset>
      {mandate && (
        <p className="text-sm text-[#d3bb73]">
          Krok 1: dane kontaktowe. Dalej otworzy się kreator umowy zlecenia z modułu
          Umowy i wynagrodzenia: dane strony, okres i zakres pracy, oświadczenia, wynagrodzenie oraz
          walidacja. Profil pozostaje nieaktywny do zatwierdzenia umowy.
        </p>
      )}
      {errors.form && (
        <p role="alert" className="text-red-300">
          {errors.form}
        </p>
      )}
      <div className="flex gap-3">
        <button
          disabled={busy || (mandate && (access.loading || loadingPersonnel || !!personnelLoadError))}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914] disabled:opacity-50"
        >
          {busy
            ? 'Zapisywanie…'
            : mandate
              ? 'Zapisz i przejdź do umowy zlecenia'
              : 'Zapisz podwykonawcę'}
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            data-crm-action="secondary"
            className="px-4 py-2"
          >
            Anuluj
          </button>
        )}
      </div>
    </form>
  );
}
