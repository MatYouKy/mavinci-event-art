'use client';

import React from 'react';
import TechnicalOfferBrochure from './TechnicalOfferBrochure';

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  position: string | null;
}

interface TechnicalBrochureEditorProps {
  employee: Employee | null;
}

export default function TechnicalBrochureEditor({ employee }: TechnicalBrochureEditorProps) {
  return <TechnicalOfferBrochure showControls={true} />;
}
