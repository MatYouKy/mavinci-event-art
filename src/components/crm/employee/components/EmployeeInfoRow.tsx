export function EmployeeInfoRow({ label, value }: { label: string; value?: string | null }) {
  if (value == null || value === '') return null;

  return (
    <div>
      <span className="text-xs text-[#e5e4e2]/60">{label}</span>
      <p className="text-[#e5e4e2]">{value}</p>
    </div>
  );
}
