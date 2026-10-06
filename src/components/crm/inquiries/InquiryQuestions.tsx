import { InquiryQuestion, questionStatusLabels } from '@/lib/CRM/inquiries/questions';
export default function InquiryQuestions({ questions, disabled, onChange }: { questions: InquiryQuestion[]; disabled: boolean; onChange: (questions: InquiryQuestion[]) => void }) {
  const update = (id: string, patch: Partial<InquiryQuestion>) => onChange(questions.map(item => item.id === id ? { ...item, ...patch, updated_at: new Date().toISOString() } : item));
  return <fieldset disabled={disabled} className="mt-5 space-y-4 disabled:opacity-60">
    <h3 className="text-sm font-medium">Ustalenia z klientem</h3>
    <p className="text-xs opacity-60">Wpisz odpowiedzi po rozmowie. Przed analizą zapisujemy wszystkie zmiany. Odpowiedzi i źródło pozostają w historii.</p>
    {questions.map((item, index) => <div key={item.id} className="space-y-2 rounded-lg bg-black/20 p-4">
      <label className="block text-sm">{index + 1}. {item.question}<textarea value={item.answer} onChange={e => update(item.id, { answer: e.target.value, source: item.source === 'Analiza AI' ? 'Uzupełnienie handlowca' : item.source })} rows={3} placeholder="Odpowiedź klienta…" className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3" /></label>
      <div className="flex flex-wrap gap-3"><label className="text-xs">Stan<select value={item.status} onChange={e => update(item.id, { status: e.target.value as InquiryQuestion['status'] })} className="ml-2 rounded bg-[#1c1f33] p-2">{Object.entries(questionStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs">Źródło<input value={item.source} onChange={e => update(item.id, { source: e.target.value })} placeholder="np. rozmowa telefoniczna" className="ml-2 rounded bg-black/20 p-2" /></label></div>
    </div>)}
    <button type="button" className="text-sm text-[#d3bb73]" onClick={() => { const question = window.prompt('Treść pytania'); if (question?.trim()) onChange([...questions, { id: crypto.randomUUID(), question: question.trim(), answer: '', status: 'unanswered', source: 'Handlowiec', updated_at: null }]); }}>Dodaj pytanie</button>
  </fieldset>;
}
