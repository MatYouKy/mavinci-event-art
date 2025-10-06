import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Stats from '@/components/Stats';
import Divider from '@/components/Divider';
import Services from '@/components/Services';
import Portfolio from '@/components/Portfolio';
import DividerTwo from '@/components/DividerTwo';
import Team from '@/components/Team';
import DividerThree from '@/components/DividerThree';
import Process from '@/components/Process';
import DividerFour from '@/components/DividerFour';
import Contact from '@/components/Contact';
import Footer from '@/components/Footer';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <Stats />
      <Divider />
      <Services />
      <Portfolio />
      <DividerTwo />
      <Team />
      <DividerThree />
      <Process />
      <DividerFour />
      <Contact />
      <Footer />
    </div>
  );
}
export const dynamic = 'force-dynamic';
