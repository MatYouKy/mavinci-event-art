import { CheckCircle } from 'lucide-react';

/** Shared by server-rendered sections and editors; no browser-only dependencies. */
export function getIconFunction(iconName: string | null | undefined) {
  const icons: Record<string, typeof CheckCircle> = { CheckCircle };
  return iconName ? icons[iconName] ?? CheckCircle : CheckCircle;
}
