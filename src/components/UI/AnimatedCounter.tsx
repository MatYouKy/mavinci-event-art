/** The published figure is also present in the initial HTML and without JavaScript. */
export function AnimatedCounter({ end, suffix }: { end: number; duration?: number; suffix: string }) {
  return <div data-brand-number="true" className="text-5xl md:text-6xl font-light text-[#d3bb73] mb-3">{end}{suffix}</div>;
}
