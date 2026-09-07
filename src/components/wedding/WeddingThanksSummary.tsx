import { readThanksEntries, THANKS_GROUP_LABELS, THANKS_SIDE_LABELS } from '@/lib/weddingCardDetails';

export default function WeddingThanksSummary({ value }: { value: unknown }) {
  const entries = readThanksEntries(value);
  if (!entries.length) return <p className="text-sm text-white/45">Nie dodano jeszcze wyjść do podziękowań.</p>;
  return <ol className="space-y-3">{entries.map((entry, index) => <li key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
    <p className="font-medium text-[#d2b859]">Wyjście {index + 1}: {THANKS_GROUP_LABELS[entry.group]}</p>
    <ul className="mt-2 space-y-1">{entry.recipients.filter((person) => person.name.trim()).map((person) => <li key={person.id} className="text-sm text-white/75">{person.name}{person.side && <span className="text-white/45"> · {THANKS_SIDE_LABELS[person.side]}</span>}</li>)}</ul>
    {entry.notes && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-white/55">Notatki: {entry.notes}</p>}
  </li>)}</ol>;
}

