import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Volume2, MonitorPlay, Radio, MapPin, Plus } from 'lucide-react';
import HomeExpertiseMotion from './HomeExpertiseMotion';
import styles from './HomeExpertise.module.css';

const services = [
  { href: '/uslugi/systemy-line-array-meyer-sound-lina', icon: Volume2, label: 'Dźwięk',
    title: 'Meyer Sound LINA', text: 'Własne nagłośnienie i realizatorzy, którzy dobierają system do Twojego wydarzenia.' },
  { href: '/uslugi/ekrany-led-do-konferencji-i-gall', icon: MonitorPlay, label: 'Obraz',
    title: 'LED i multimedia', text: 'Prezentacje, oprawa sceny i realizacja wizji. Obraz spójny z programem.' },
  { href: '/oferta/streaming', icon: Radio, label: 'Transmisja',
    title: 'Streaming na żywo', text: 'Realizacja wielokamerowa, dźwięk i nagrania dla uczestników online.' },
];

const cities = [
  ['olsztyn', 'Olsztyn'], ['ostroda', 'Ostróda'], ['ilawa', 'Iława'], ['elblag', 'Elbląg'],
  ['mragowo', 'Mrągowo'], ['mikolajki', 'Mikołajki'], ['gizycko', 'Giżycko'],
  ['elk', 'Ełk'], ['ketrzyn', 'Kętrzyn'], ['szczytno', 'Szczytno'],
];

/** Sized files are generated in advance: no full-resolution downloads or resize service. */
function RealizationPhoto({ name, alt }: { name: 'eventy' | 'technika'; alt: string }) {
  return <img
    src={`/images/expertise/${name}-768.webp`}
    srcSet={[480, 768, 1280].map((width) => `/images/expertise/${name}-${width}.webp ${width}w`).join(', ')}
    sizes="(min-width: 1328px) 620px, (min-width: 800px) calc(50vw - 40px), calc(100vw - 40px)"
    alt={alt} width={1280} height={name === 'technika' ? 854 : 853} loading="lazy" decoding="async"
    className={styles.photo}
  />;
}

export default function HomeExpertise() {
  return <HomeExpertiseMotion>
    <section id="nasze-mozliwosci" className={styles.section} aria-labelledby="expertise-heading">
      <div className={styles.inner}>
        <header className={styles.heading} data-expertise-reveal>
          <div>
            <p className={styles.eyebrow}><span aria-hidden="true" /> Jeden zespół. Wiele możliwości.</p>
            <h2 id="expertise-heading" className={styles.title}>Organizacja eventów.<br /><span>Własna technika.</span></h2>
          </div>
          <p className={styles.intro}>Jako firma eventowa z Olsztyna łączymy organizację wydarzeń z własnym zapleczem technicznym. Przygotowujemy scenariusz, koordynujemy ekipę i realizujemy dźwięk oraz obraz. Powierz nam cały event lub wybrany zakres obsługi.</p>
        </header>

        <div className={styles.pillars}>
          <article className={styles.pillar} data-expertise-reveal>
            <Link href="/portfolio/latino-night-castorama" className={styles.visual} aria-label="Zobacz realizację Latino Night Castorama" prefetch={false}>
              <RealizationPhoto name="eventy" alt="Uczestnicy Latino Night Castorama na parkiecie w oprawie świetlnej MAVINCI" />
              <span className={styles.photoShade} aria-hidden="true" />
              <span className={styles.pillarNumber} aria-hidden="true">01 / Organizacja</span>
              <span className={styles.photoCaption}>Latino Night Castorama <ArrowUpRight size={18} aria-hidden="true" /></span>
            </Link>
            <div className={styles.pillarBody}>
              <p className={styles.label}>Od scenariusza po wspólne emocje</p>
              <h3>Eventy firmowe<br />i integracje</h3>
              <p className={styles.description}>Koncepcja, koordynacja i program, który angażuje. Konferencję lub galę łączymy z muzyką, wieczorem tematycznym i rozrywką.</p>
              <Link href="/oferta/integracje" className={styles.textLink}>Poznaj nasze integracje <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/oferta" className={styles.secondaryLink}>Wszystkie formaty wydarzeń</Link>
            </div>
          </article>

          <article className={styles.pillar} data-expertise-reveal data-expertise-delay="80">
            <Link href="/portfolio/konferencja-psrwn" className={styles.visual} aria-label="Zobacz obsługę konferencji PSRWN w Olsztynie" prefetch={false}>
              <RealizationPhoto name="technika" alt="Realizator MAVINCI przy stanowisku obsługi multimediów podczas konferencji PSRWN" />
              <span className={styles.photoShade} aria-hidden="true" />
              <span className={styles.pillarNumber} aria-hidden="true">02 / Technika</span>
              <span className={styles.photoCaption}>Za kulisami konferencji PSRWN <ArrowUpRight size={18} aria-hidden="true" /></span>
            </Link>
            <div className={styles.pillarBody}>
              <p className={styles.label}>Własny sprzęt. Doświadczona ekipa.</p>
              <h3>Technika konferencji<br />i wydarzeń</h3>
              <p className={styles.description}>Meyer Sound, ekrany LED, światło i streaming. Dobieramy sprzęt, przygotowujemy montaż i prowadzimy realizację zgodnie z programem.</p>
              <Link href="/oferta/technika-sceniczna/olsztyn" className={styles.textLink}>Technika sceniczna w Olsztynie <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link href="/oferta/konferencje/olsztyn" className={styles.secondaryLink}>Obsługa konferencji w Olsztynie</Link>
            </div>
          </article>
        </div>

        <div className={styles.services}>
          {services.map(({ href, icon: Icon, label, title, text }, index) => <Link
            key={href} href={href} className={styles.service} prefetch={false}
            data-expertise-reveal data-expertise-delay={index * 50}
          >
            <span className={styles.serviceIcon}><Icon size={24} strokeWidth={1.5} aria-hidden="true" /></span>
            <div className={styles.serviceCopy}>
              <span className={styles.label}>{label}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
            <ArrowUpRight className={styles.serviceArrow} size={20} aria-hidden="true" />
          </Link>)}
        </div>

        <div className={styles.partner} data-expertise-reveal>
          <div>
            <p className={styles.label}>Dla agencji eventowych i hoteli</p>
            <h3>Twój pomysł. Nasze zaplecze.</h3>
            <p>Dołączamy do Twojego zespołu z techniką, realizacją i oprawą wydarzenia.</p>
          </div>
          <Link href="/dla-agencji-i-hoteli" className={styles.partnerLink}>Porozmawiajmy o współpracy <ArrowUpRight size={20} aria-hidden="true" /></Link>
        </div>

        <div className={styles.region} data-expertise-reveal>
          <div className={styles.regionIntro}>
            <MapPin size={19} aria-hidden="true" />
            <p>Warmia i Mazury oraz cała Polska.<span>Biuro i magazyn: ul. Towarowa 20B, Olsztyn.</span></p>
          </div>
          <details className={styles.cities}>
            <summary>Obsługa konferencji w regionie <Plus size={18} aria-hidden="true" /></summary>
            <nav aria-label="Obsługa konferencji na Warmii i Mazurach" className={styles.cityLinks}>
              {cities.map(([slug, name]) => <Link key={slug} href={`/oferta/konferencje/${slug}`} prefetch={false}>{name}</Link>)}
            </nav>
          </details>
        </div>
      </div>
    </section>
  </HomeExpertiseMotion>;
}
