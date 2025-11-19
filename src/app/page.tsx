import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Stats from '@/components/Stats';
import Divider from '@/components/Divider';
import Services from '@/components/Services';
import OfertaSection from '@/components/OfertaSection';
import Portfolio from '@/components/Portfolio';
import DividerTwo from '@/components/DividerTwo';
import Team from '@/components/Team';
import DividerThree from '@/components/DividerThree';
import Process from '@/components/Process';
import DividerFour from '@/components/DividerFour';
import Contact from '@/components/Contact';
import Footer from '@/components/Footer';
import WebsiteEditPanel from '@/components/WebsiteEditPanel';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Hero />
      <Stats />
      <Divider />
      <Services />
      <OfertaSection />
      <Portfolio />
      <DividerTwo />
      <Team />
      <DividerThree />
      <Process />
      <DividerFour />
      <Contact />
      <WebsiteEditPanel />
    </div>
  );
}
export const dynamic = 'force-dynamic';
