'use client';

import React from 'react';
import TechnicalOfferBrochure from './TechnicalOfferBrochure';
import { IEmployee } from '../employees/type';

interface TechnicalBrochureEditorProps {
  employee: IEmployee | null;
}

export default function TechnicalBrochureEditor({ employee }: TechnicalBrochureEditorProps) {
  return <TechnicalOfferBrochure showControls={true} />;
}
