/**
 * Przykład użycia placeholdera {{OFFER_ITEMS_TABLE}} w komponencie generującym dokument
 */

'use client';

import { useState } from 'react';
import { replaceOfferItemsTablePlaceholder, fetchOfferItems } from './offerTemplateHelpers';

interface ContractGeneratorProps {
  offerId: string;
  templateContent: string;
}

export default function ContractGeneratorExample({ offerId, templateContent }: ContractGeneratorProps) {
  const [processedContent, setProcessedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const generateDocument = async () => {
    try {
      setLoading(true);

      // 1. Pobierz pozycje oferty z bazy danych
      const offerItems = await fetchOfferItems(offerId);

      // 2. Zastąp placeholder {{OFFER_ITEMS_TABLE}} tabelą HTML
      const content = replaceOfferItemsTablePlaceholder(templateContent, offerItems);

      // 3. Zastąp inne placeholdery (client_name, event_date, itp.)
      // const finalContent = replaceOtherPlaceholders(content, otherData);

      setProcessedContent(content);
    } catch (error) {
      console.error('Błąd generowania dokumentu:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <button
        onClick={generateDocument}
        disabled={loading}
        className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg"
      >
        {loading ? 'Generowanie...' : 'Generuj dokument'}
      </button>

      {processedContent && (
        <div className="mt-6 border border-gray-300 p-4 rounded">
          <h3 className="text-lg font-semibold mb-4">Podgląd dokumentu:</h3>
          <div dangerouslySetInnerHTML={{ __html: processedContent }} />
        </div>
      )}
    </div>
  );
}

/**
 * Przykład użycia w API Route lub Server Action
 */

// app/api/contracts/generate/route.ts
/*
import { NextRequest, NextResponse } from 'next/server';
import { replaceOfferItemsTablePlaceholder, fetchOfferItems } from '@/lib/offerTemplateHelpers';

export async function POST(request: NextRequest) {
  try {
    const { offerId, templateContent } = await request.json();

    // Pobierz pozycje oferty
    const offerItems = await fetchOfferItems(offerId);

    // Zastąp placeholder tabelą
    const processedContent = replaceOfferItemsTablePlaceholder(templateContent, offerItems);

    // Tutaj możesz dodać generowanie PDF lub zapisanie do bazy
    // const pdfBuffer = await generatePDF(processedContent);

    return NextResponse.json({
      success: true,
      content: processedContent
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
*/

/**
 * Przykład użycia z danymi hardcoded (do testowania)
 */

export function QuickTestExample() {
  const testTemplate = `
    <h1>Oferta komercyjna</h1>
    <p>Data: {{current_date}}</p>

    <h2>Zakres usług:</h2>
    {{OFFER_ITEMS_TABLE}}

    <p>Suma całkowita: {{total_amount}}</p>
  `;

  const testItems = [
    {
      id: '1',
      name: 'System nagłośnienia liniowego',
      description: 'Profesjonalny system CODA N-RAY z pełnym DSP',
      quantity: 1,
      unit: 'kpl.',
      unit_price: 5000,
      discount_percent: null,
      total: 5000,
    },
    {
      id: '2',
      name: 'Oświetlenie LED',
      description: '12x reflektor LED PAR64 RGBW',
      quantity: 12,
      unit: 'szt.',
      unit_price: 150,
      discount_percent: 10,
      total: 1620,
    },
    {
      id: '3',
      name: 'Obsługa techniczna',
      description: 'DJ + Realizator dźwięku',
      quantity: 8,
      unit: 'godz.',
      unit_price: 300,
      discount_percent: null,
      total: 2400,
    },
  ];

  const result = replaceOfferItemsTablePlaceholder(testTemplate, testItems);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Test Placeholdera {{'{{'}}OFFER_ITEMS_TABLE{{'}}'}}</h2>
      <div
        className="border border-gray-300 rounded-lg p-6 bg-white"
        dangerouslySetInnerHTML={{ __html: result }}
      />
    </div>
  );
}
