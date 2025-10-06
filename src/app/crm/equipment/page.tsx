'use client';

import { useState } from 'react';
import { Plus, Search, Package, AlertCircle } from 'lucide-react';

export default function EquipmentPage() {
  const equipment = [
    {
      id: '1',
      name: 'Nagłośnienie JBL EON615',
      category: 'sound',
      quantity: 20,
      available_quantity: 8,
      unit_price: 500,
      status: 'available',
    },
    {
      id: '2',
      name: 'Światło LED Moving Head',
      category: 'lighting',
      quantity: 15,
      available_quantity: 7,
      unit_price: 800,
      status: 'available',
    },
    {
      id: '3',
      name: 'Projektor Full HD',
      category: 'video',
      quantity: 8,
      available_quantity: 3,
      unit_price: 1200,
      status: 'available',
    },
  ];

  const categoryColors = {
    sound: 'bg-blue-500/20 text-blue-400',
    lighting: 'bg-yellow-500/20 text-yellow-400',
    video: 'bg-purple-500/20 text-purple-400',
    stage: 'bg-green-500/20 text-green-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn sprzętu</h2>
        <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
          <Plus className="w-4 h-4" />
          Dodaj sprzęt
        </button>
      </div>

      <div className="grid gap-4">
        {equipment.map((item) => (
          <div
            key={item.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                  <Package className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">
                    {item.name}
                  </h3>
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs ${
                      categoryColors[item.category as keyof typeof categoryColors]
                    }`}
                  >
                    {item.category}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-2xl font-light text-[#e5e4e2] mb-1">
                  {item.available_quantity} / {item.quantity}
                </div>
                <div className="text-sm text-[#e5e4e2]/60">dostępne</div>
                {item.available_quantity < item.quantity * 0.3 && (
                  <div className="flex items-center gap-1 text-xs text-red-400 mt-2">
                    <AlertCircle className="w-3 h-3" />
                    Niski stan
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[#d3bb73]/10 flex justify-between items-center">
              <div className="text-sm text-[#e5e4e2]/70">
                Cena jednostkowa: <span className="text-[#d3bb73]">{item.unit_price} zł</span>
              </div>
              <div className="w-full max-w-xs">
                <div className="h-2 bg-[#0f1119] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#d3bb73] rounded-full transition-all"
                    style={{
                      width: `${(item.available_quantity / item.quantity) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
