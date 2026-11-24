export default function SharedFilesNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[#d3bb73]/15 bg-white/[0.03] p-8 text-center">
        <h1 className="text-xl text-[#e5e4e2]">Nie znaleziono linku</h1>
        <p className="mt-3 text-sm leading-6 text-[#e5e4e2]/60">
          Ten adres nie prowadzi do żadnych plików — link mógł zostać usunięty albo jest niepełny. Poproś o nowy link osobę,
          która go przesłała.
        </p>
      </div>
    </main>
  );
}
