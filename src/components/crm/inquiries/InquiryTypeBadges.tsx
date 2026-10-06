import SystemBadge from '@/components/UI/SystemBadge';
import { inquiryTypeLabels, type InquiryLabelDetails } from '@/lib/ui/systemLabels';

export default function InquiryTypeBadges({ title, details }: { title: string; details?: InquiryLabelDetails | null }) {
  const labels = inquiryTypeLabels(title, details);
  if (!labels.length) return null;
  return <span className="inline-flex flex-wrap gap-1.5">{labels.map((label) => <SystemBadge key={label} domain="formCategory" label={label} />)}</span>;
}
