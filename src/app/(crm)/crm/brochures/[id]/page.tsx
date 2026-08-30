'use client';

import { useParams } from 'next/navigation';
import BrochureEditorClient from './BrochureEditorClient';

export default function BrochureEditorPage() {
  const params = useParams();
  return <BrochureEditorClient brochureId={String(params.id)} />;
}
