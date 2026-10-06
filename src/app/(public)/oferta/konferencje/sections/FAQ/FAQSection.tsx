type FAQSectionProps = {
  faq: { id: string; question: string; answer: string }[];
};

/** Answers are in the initial HTML and remain usable without JavaScript. */
export function FAQSection({ faq }: FAQSectionProps) {
  if (!faq.length) return null;
  return (
    <section className="px-5 py-12 sm:px-6 md:py-16" aria-labelledby="conference-faq-heading">
      <div className="mx-auto max-w-4xl">
        <h2 id="conference-faq-heading" className="mb-8 text-2xl font-light uppercase text-[#e5e4e2] sm:text-3xl">
          Pytania o obsługę konferencji
        </h2>
        <div className="space-y-3">
          {faq.map(item => (
            <details key={item.id} className="group rounded-xl bg-white/[0.04] text-[#e5e4e2] open:bg-white/[0.07]">
              <summary className="cursor-pointer px-5 py-4 text-base font-medium leading-relaxed marker:text-[#d3bb73] hover:text-[#d3bb73] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50">
                {item.question}
              </summary>
              <p className="px-5 pb-5 text-sm leading-7 text-white/75 sm:text-base">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
