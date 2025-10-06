'use client';

export default function DividerThree() {
  return (
    <section className="relative h-[50vh] md:h-[60vh] overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed"
        style={{
          backgroundImage: 'url(https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=1920)',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/90 via-[#800020]/80 to-[#1c1f33]/90"></div>
      </div>

      <div className="relative z-10 h-full flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl text-center">
          <div className="mb-8 animate-[fadeIn_1s_ease-out]">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#d3bb73]"></div>
              <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase">
                Sprawdzony Proces
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#d3bb73]"></div>
            </div>
          </div>

          <h2 className="text-4xl sm:text-5xl md:text-6xl font-light text-[#e5e4e2] mb-6 leading-tight animate-[fadeIn_1.2s_ease-out]">
            Od wizji do realizacji
          </h2>

          <p className="text-base md:text-lg text-[#e5e4e2]/90 font-light leading-relaxed max-w-2xl mx-auto animate-[fadeIn_1.4s_ease-out]">
            Każdy etap starannie zaplanowany, każdy krok przemyślany
          </p>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItaDJ2LTJoLTJ6bTAtNGgydjJoLTJ2LTJ6bS0yIDJoMnYyaC0ydi0yem0wLTJoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yeiIvPjwvZz48L2c+PC9zdmc+')] opacity-20"></div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
