'use client';

interface OfferStep2Data {
  offer_number: string;
  valid_until: string;
  notes: string;
}

interface OfferStep2Props {
  offerData: OfferStep2Data;
  setOfferData: (data: OfferStep2Data) => void;
}

export default function OfferStep2({
  offerData,
  setOfferData,
}: OfferStep2Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
        <p className="text-sm text-blue-400">
          Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np.
          OF/2025/11/001)
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
          Numer oferty (opcjonalnie)
        </label>
        <input
          type="text"
          value={offerData.offer_number}
          onChange={(e) =>
            setOfferData({ ...offerData, offer_number: e.target.value })
          }
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          placeholder="Zostaw puste dla automatycznego numeru"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ważna do</label>
        <input
          type="date"
          value={offerData.valid_until}
          onChange={(e) =>
            setOfferData({ ...offerData, valid_until: e.target.value })
          }
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki</label>
        <textarea
          value={offerData.notes}
          onChange={(e) =>
            setOfferData({ ...offerData, notes: e.target.value })
          }
          className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          placeholder="Dodatkowe informacje o ofercie..."
        />
      </div>
    </div>
  );
}