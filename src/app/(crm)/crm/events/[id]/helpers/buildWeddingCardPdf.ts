import { isWeddingReceptionGame } from '@/lib/weddingAttractions';
import { readThanksEntries, THANKS_GROUP_LABELS, THANKS_SIDE_LABELS, WELCOME_GLASS_OPTIONS } from '@/lib/weddingCardDetails';

export type WeddingCardPdfAnswer = {
  section: string;
  fieldKey: string;
  value: unknown;
};

export type WeddingCardPdfPerson = {
  side: 'bride' | 'groom' | 'shared';
  role: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  instagramTagConsent?: boolean | null;
  notes?: string | null;
};

export type WeddingCardPdfScheduleItem = {
  title: string;
  scheduledAt?: string | null;
  category?: string | null;
  location?: string | null;
  responsiblePerson?: string | null;
  notes?: string | null;
  isConfirmed?: boolean | null;
};

export type WeddingCardPdfTrack = {
  listType: 'play' | 'do_not_play' | 'special';
  title: string;
  artist?: string | null;
  url?: string | null;
  notes?: string | null;
};

export type WeddingCardPdfAttraction = {
  key: string;
  name: string;
  choice: 'undecided' | 'interested' | 'selected' | 'rejected';
  notes?: string | null;
};

export type WeddingCardPdfPayload = {
  eventName: string;
  eventDate?: string | null;
  eventEndDate?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  clientName?: string | null;
  cardStatus: string;
  cardProgress: number;
  generatedAt: string;
  answers: WeddingCardPdfAnswer[];
  people: WeddingCardPdfPerson[];
  schedule: WeddingCardPdfScheduleItem[];
  tracks: WeddingCardPdfTrack[];
  attractions: WeddingCardPdfAttraction[];
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const clean = (value: unknown) => String(value ?? '').trim();

const safeHttpUrl = (value: unknown) => {
  const candidate = clean(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

const isExplicitlyFalse = (value: unknown) =>
  value === false || value === 'false' || value === 0 || value === '0';

const formatDateTime = (value?: string | null, includeTime = true) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
};

const ANSWER_LABELS: Record<string, string> = {
  ceremony_type: 'Rodzaj ceremonii',
  ceremony_time: 'Godzina ślubu',
  church_address: 'Adres kościoła',
  civil_ceremony_setting: 'Miejsce ceremonii cywilnej',
  ceremony_address: 'Adres ceremonii',
  church_wishes_enabled: 'Życzenia pod kościołem',
  guest_count: 'Liczba gości',
  ceremony: 'Dodatkowe informacje o ceremonii',
  venue_arrival_time: 'Przyjazd na salę',
  venue_access: 'Dostęp do sali i schody',
  hot_vodka: 'Gorzka wódka',
  first_dance: 'Pierwszy taniec',
  first_dance_title: 'Pierwszy taniec — tytuł utworu',
  first_dance_artist: 'Pierwszy taniec — wykonawca / wersja',
  first_dance_url: 'Pierwszy taniec — link do utworu',
  first_dance_duration: 'Pierwszy taniec — czas trwania',
  first_dance_special_moments: 'Pierwszy taniec — punkty specjalne',
  first_dance_file_url: 'Pierwszy taniec — własny plik audio',
  first_dance_file_name: 'Pierwszy taniec — nazwa pliku',
  special_toasts: 'Specjalne toasty',
  couple_wait_before_welcome: 'Para czeka przed powitaniem',
  bread_and_salt_enabled: 'Powitanie chlebem i solą',
  welcome_throwing: 'Czym witamy / rzucamy',
  welcome_glasses: 'Kieliszki powitalne',
  welcome_glass_throwing: 'Rzucanie kieliszkami',
  welcome_sequence: 'Kolejność powitania',
  cake_time: 'Godzina podania tortu',
  cake_presentation: 'Aranżacja podania tortu',
  cake_proposal_url: 'Wybrana propozycja tortu — opis, zdjęcia i filmy',
  cake_location: 'Miejsce podania tortu',
  parents_thanks_enabled: 'Podziękowania dla bliskich',
  parents_thanks_recipients: 'Osoby objęte podziękowaniami',
  parents_thanks_plan: 'Forma podziękowań',
  parents_thanks_proposal_url: 'Wybrana propozycja podziękowań — opis, zdjęcia i filmy',
  oczepiny_enabled: 'Oczepiny',
  oczepiny_notes: 'Ustalenia dotyczące oczepin',
  spotify_playlist_url: 'Playlista Spotify',
  youtube_playlist_url: 'Playlista YouTube',
  general_notes: 'Uwagi dla zespołu',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  welcome_glass_throwing: Object.fromEntries(WELCOME_GLASS_OPTIONS.map((option) => [option.value, option.label])),
  ceremony_type: { church: 'Kościelna', civil: 'Cywilna', humanist: 'Humanistyczna' },
  civil_ceremony_setting: { registry_office: 'W urzędzie', outdoor: 'W plenerze' },
  welcome_throwing: {
    none: 'Bez rzucania',
    rice: 'Ryż',
    petals: 'Płatki kwiatów',
    confetti: 'Konfetti',
    coins: 'Monety',
    other: 'Inne',
  },
  welcome_glasses: {
    vodka: 'Kieliszki z wódką',
    champagne: 'Kieliszki do szampana',
    none: 'Bez kieliszków',
  },
};

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Nie rozpoczęto',
  in_progress: 'W trakcie uzupełniania',
  submitted: 'Przesłana do weryfikacji',
  approved: 'Zatwierdzona',
  changes_requested: 'Wymaga uzupełnienia',
};

const ROLE_LABELS: Record<string, string> = {
  bride: 'Panna Młoda',
  groom: 'Pan Młody',
  witness: 'Świadek / Świadkowa',
  mother: 'Mama',
  father: 'Tata',
  godparent: 'Chrzestny / Chrzestna',
  guardian: 'Opiekun / Opiekunka',
  subcontractor: 'Podwykonawca',
  venue_contact: 'Osoba po stronie sali',
  other: 'Inna osoba',
};

const CATEGORY_LABELS: Record<string, string> = {
  preparation: 'Przygotowania',
  ceremony: 'Ceremonia',
  arrival: 'Przyjazd',
  meal: 'Posiłek',
  first_dance: 'Pierwszy taniec',
  cake: 'Tort',
  parents_thanks: 'Podziękowania',
  oczepiny: 'Oczepiny',
  attraction: 'Atrakcja',
  ending: 'Zakończenie',
  other: 'Inne',
};

const LINK_ANSWER_FIELDS = new Set([
  'cake_proposal_url',
  'parents_thanks_proposal_url',
  'first_dance_url',
  'first_dance_file_url',
  'spotify_playlist_url',
  'youtube_playlist_url',
]);

const isFilled = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isFilled);
  return true;
};

const formatAnswerValue = (fieldKey: string, value: unknown) => {
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean).join(', ');
  if (typeof value === 'object' && value) {
    return Object.values(value as Record<string, unknown>)
      .map((item) => clean(item))
      .filter(Boolean)
      .join(' · ');
  }
  const normalized = clean(value);
  return VALUE_LABELS[fieldKey]?.[normalized] || normalized;
};

const renderInfoRows = (answers: WeddingCardPdfAnswer[]) => {
  const rows = answers
    .filter((answer) => ANSWER_LABELS[answer.fieldKey] && isFilled(answer.value))
    .map((answer) => {
      const href = LINK_ANSWER_FIELDS.has(answer.fieldKey) ? safeHttpUrl(answer.value) : null;
      const value = answer.fieldKey === 'first_dance_file_url'
        ? 'Otwórz przesłany plik audio'
        : formatAnswerValue(answer.fieldKey, answer.value);
      return `
        <div class="info-row">
          <dt>${escapeHtml(ANSWER_LABELS[answer.fieldKey])}</dt>
          <dd>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>` : escapeHtml(value)}</dd>
        </div>`;
    })
    .join('');
  return rows || '<p class="empty">Brak uzupełnionych informacji.</p>';
};

const renderPeople = (people: WeddingCardPdfPerson[]) => {
  const groups = [
    { side: 'bride', title: 'Strona Panny Młodej' },
    { side: 'groom', title: 'Strona Pana Młodego' },
    { side: 'shared', title: 'Pozostałe osoby organizacyjne' },
  ] as const;

  return groups
    .map(({ side, title }) => {
      const group = people.filter((person) => person.side === side && clean(person.firstName));
      if (!group.length) return '';
      return `
        <div class="people-group">
          <h3>${escapeHtml(title)}</h3>
          ${group
            .map((person) => {
              const details = [person.phone, person.email]
                .map(clean)
                .filter(Boolean)
                .map(escapeHtml)
                .join(' · ');
              const instagram = clean(person.instagramHandle)
                ? `@${clean(person.instagramHandle).replace(/^@+/, '')} · ${person.instagramTagConsent ? 'zgoda na oznaczanie' : 'bez zgody na oznaczanie'}`
                : '';
              return `<div class="person">
                <div><strong>${escapeHtml([person.firstName, person.lastName].map(clean).filter(Boolean).join(' '))}</strong><span>${escapeHtml(ROLE_LABELS[person.role] || person.role)}</span></div>
                ${details ? `<p>${details}</p>` : ''}
                ${instagram ? `<p>${escapeHtml(instagram)}</p>` : ''}
                ${clean(person.notes) ? `<p class="note">${escapeHtml(person.notes)}</p>` : ''}
              </div>`;
            })
            .join('')}
        </div>`;
    })
    .join('');
};

export function buildWeddingCardPdfHtml(payload: WeddingCardPdfPayload) {
  const answerGroups = [
    { title: 'Ceremonia', sections: ['ceremony'] },
    { title: 'Przebieg i logistyka', sections: ['technical'] },
    { title: 'Przyjazd i powitanie', sections: ['welcome'] },
    { title: 'Tort weselny', sections: ['cake'] },
    { title: 'Podziękowania dla bliskich', sections: ['parents_thanks'] },
    { title: 'Oczepiny', sections: ['oczepiny'] },
    { title: 'Dodatkowe informacje', sections: ['notes'] },
  ];

  const bride = payload.people.find((person) => person.role === 'bride');
  const groom = payload.people.find((person) => person.role === 'groom');
  const coupleName = [bride?.firstName, groom?.firstName].map(clean).filter(Boolean).join(' & ');
  const guestCount = payload.answers.find((answer) => answer.fieldKey === 'guest_count')?.value;
  const noParentsThanks = isExplicitlyFalse(
    payload.answers.find((answer) => answer.fieldKey === 'parents_thanks_enabled')?.value,
  );
  const thanksEntries = readThanksEntries(payload.answers.find((answer) => answer.fieldKey === 'parents_thanks_entries')?.value);
  const newWelcome = payload.answers.some((answer) => answer.fieldKey === 'welcome_glass_throwing' && isFilled(answer.value));
  const thanksHtml = thanksEntries.map((entry, index) => `<div class="thanks-entry"><h3>Wyjście ${index + 1}: ${escapeHtml(THANKS_GROUP_LABELS[entry.group])}</h3><ul>${entry.recipients.filter((person) => person.name.trim()).map((person) => `<li>${escapeHtml(person.name)}${person.side ? ` — ${escapeHtml(THANKS_SIDE_LABELS[person.side])}` : ''}</li>`).join('')}</ul>${entry.notes ? `<p><strong>Notatki:</strong> ${escapeHtml(entry.notes)}</p>` : ''}</div>`).join('');
  const eventDate = formatDateTime(payload.eventDate);
  const eventEndDate = formatDateTime(payload.eventEndDate);
  const dateRange = [eventDate, eventEndDate && eventEndDate !== eventDate ? eventEndDate : '']
    .filter(Boolean)
    .join(' - ');

  const scheduleRows = payload.schedule
    .filter((item) => clean(item.title))
    .map(
      (item) => `<tr>
        <td class="time">${escapeHtml(formatDateTime(item.scheduledAt))}</td>
        <td><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(CATEGORY_LABELS[clean(item.category)] || clean(item.category))}</span></td>
        <td>${escapeHtml(clean(item.location) || '—')}</td>
        <td>${escapeHtml(clean(item.responsiblePerson) || '—')}${clean(item.notes) ? `<small>${escapeHtml(item.notes)}</small>` : ''}</td>
      </tr>`,
    )
    .join('');

  const selectedChoices = payload.attractions.filter((item) =>
    ['selected', 'interested'].includes(item.choice),
  );
  const weddingGameRows = selectedChoices
    .filter((item) =>
      item.choice === 'selected'
      && isWeddingReceptionGame({ attraction_key: item.key, attraction_name: item.name }),
    )
    .map(
      (item) => `<li><strong>${escapeHtml(item.name)}</strong>${clean(item.notes) ? `<span>${escapeHtml(item.notes)}</span>` : ''}</li>`,
    )
    .join('');
  const attractionRows = selectedChoices
    .filter((item) => !isWeddingReceptionGame({ attraction_key: item.key, attraction_name: item.name }))
    .map(
      (item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${item.choice === 'selected' ? 'Wybrano' : 'Rozważane'}${clean(item.notes) ? ` · ${escapeHtml(item.notes)}` : ''}</span></li>`,
    )
    .join('');

  const trackGroups = [
    { type: 'play', title: 'Co gramy' },
    { type: 'do_not_play', title: 'Czego nie gramy' },
  ] as const;
  const tracksHtml = trackGroups
    .map(({ type, title }) => {
      const tracks = payload.tracks.filter((track) =>
        type === 'play' ? track.listType !== 'do_not_play' : track.listType === 'do_not_play',
      );
      if (!tracks.length) return '';
      return `<div class="track-group"><h3>${escapeHtml(title)}</h3><ul>${tracks
        .map((track) => {
          const href = safeHttpUrl(track.url);
          const titleText = escapeHtml(track.artist ? `${track.artist} - ${track.title}` : track.title);
          return `<li><strong>${href ? `<a href="${escapeHtml(href)}">${titleText}</a>` : titleText}</strong>${clean(track.notes) ? `<span>${escapeHtml(track.notes)}</span>` : ''}</li>`;
        })
        .join('')}</ul></div>`;
    })
    .join('');

  return `<!doctype html>
  <html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Karta Weselna · ${escapeHtml(payload.eventName)}</title>
    <style>
      @page { size: A4; margin: 18mm 16mm 17mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; color: #211c20; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 9.5px; line-height: 1.45; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .running-header { position: fixed; top: -12mm; right: 0; left: 0; display: flex; align-items: center; justify-content: space-between; border-bottom: .3mm solid #d3bb73; padding-bottom: 2.3mm; color: #6b6066; font-size: 7px; letter-spacing: .08em; text-transform: uppercase; }
      .running-header strong { color: #5b0022; letter-spacing: .34em; }
      .running-footer { position: fixed; right: 0; bottom: -10mm; left: 0; display: flex; justify-content: space-between; color: #92878d; font-size: 7px; }
      .hero { position: relative; min-height: 78mm; margin: -4mm -2mm 10mm; overflow: hidden; border-radius: 4mm; padding: 12mm 11mm; color: #fff; background: #5b0022; break-inside: avoid; }
      .hero::before { content: ''; position: absolute; width: 72mm; height: 72mm; right: -25mm; top: -31mm; border-radius: 50%; background: #820032; }
      .hero::after { content: ''; position: absolute; width: 56mm; height: 56mm; right: -17mm; top: -24mm; border: .45mm solid #d3bb73; border-radius: 50%; }
      .hero-content { position: relative; z-index: 1; max-width: 135mm; }
      .eyebrow { margin: 0 0 4mm; color: #ead58e; font-size: 7.5px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 25px; font-weight: 400; line-height: 1.12; }
      .couple { margin: 3mm 0 0; color: #f2df9f; font-size: 15px; }
      .hero-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5mm; margin-top: 11mm; border-top: .25mm solid rgba(234,213,142,.65); padding-top: 5mm; }
      .hero-meta span { display: block; color: rgba(255,255,255,.58); font-size: 6.5px; letter-spacing: .12em; text-transform: uppercase; }
      .hero-meta strong { display: block; margin-top: 1.2mm; color: #fff; font-size: 9px; font-weight: 600; }
      .summary { display: grid; grid-template-columns: 1.15fr .85fr; gap: 6mm; margin-bottom: 8mm; }
      .card { border: .25mm solid #ded5da; border-radius: 3mm; padding: 5mm; background: #fff; break-inside: avoid; }
      .card h2, .section h2 { margin: 0 0 4mm; color: #5b0022; font-size: 13px; font-weight: 600; }
      .status-line { display: flex; justify-content: space-between; gap: 4mm; margin-bottom: 3mm; color: #6e6369; }
      .progress { height: 2mm; overflow: hidden; border-radius: 2mm; background: #eee8eb; }
      .progress span { display: block; height: 100%; background: #d3bb73; }
      .section { margin: 0 0 7mm; break-inside: avoid; }
      .section-header { display: flex; align-items: center; gap: 3mm; margin-bottom: 3mm; }
      .section-header::before { content: ''; width: 5mm; height: 1.1mm; border-radius: 1mm; background: #d3bb73; }
      .critical-note { border: .45mm solid #b91c1c; border-radius: 2.5mm; padding: 4mm; color: #b91c1c; background: #fff1f2; font-size: 12px; font-weight: 800; }
      .info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 7mm; border-top: .25mm solid #e5dde1; }
      .info-row { display: grid; grid-template-columns: 42mm minmax(0,1fr); gap: 4mm; border-bottom: .25mm solid #eee8eb; padding: 2.4mm 0; break-inside: avoid; }
      .info-row dt { color: #786c72; font-size: 8px; }
      .info-row dd { margin: 0; min-width: 0; color: #241e22; font-weight: 600; overflow-wrap: anywhere; white-space: pre-wrap; }
      .info-row a, .track-group a { color: #5b0022; text-decoration: underline; text-decoration-color: #d3bb73; text-underline-offset: 1.2mm; }
      .people-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 5mm; }
      .people-group { border: .25mm solid #e5dde1; border-radius: 3mm; padding: 4mm; break-inside: avoid; }
      .people-group h3, .track-group h3 { margin: 0 0 2.5mm; color: #8a7338; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
      .person { border-top: .25mm solid #f0ebed; padding: 2.2mm 0; break-inside: avoid; }
      .person:first-of-type { border-top: 0; }
      .person div { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; }
      .person span { color: #84787e; font-size: 7.5px; }
      .person p { margin: .8mm 0 0; color: #675c62; font-size: 7.5px; }
      .person .note { color: #8a7338; font-style: italic; }
      table { width: 100%; border-collapse: collapse; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th { background: #5b0022; color: #fff; padding: 2.4mm; text-align: left; font-size: 7px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
      td { border-bottom: .25mm solid #e7e0e3; padding: 2.6mm 2.4mm; vertical-align: top; }
      td.time { width: 31mm; color: #5b0022; font-weight: 600; }
      td strong { display: block; }
      td span, td small { display: block; margin-top: .6mm; color: #8a7f84; font-size: 7.3px; }
      .choice-list, .track-group ul { margin: 0; padding: 0; list-style: none; }
      .choice-list { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 2mm 6mm; }
      .choice-list li, .track-group li { display: flex; justify-content: space-between; gap: 3mm; border-bottom: .25mm solid #eee8eb; padding: 2mm 0; break-inside: avoid; }
      .choice-list span, .track-group span { color: #877b81; font-size: 7.5px; text-align: right; }
      .tracks { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 5mm; }
      .track-group { border: .25mm solid #e5dde1; border-radius: 3mm; padding: 4mm; break-inside: avoid; }
      .empty { margin: 0; color: #988d92; font-style: italic; }
      .page-break { break-before: page; }
      .thanks-entry { margin-top: 3mm; padding: 3mm; border: .25mm solid #e5dde1; border-radius: 2mm; break-inside: avoid; }
      .thanks-entry h3 { margin: 0 0 2mm; color: #5b0022; font-size: 10px; }
      .thanks-entry ul { margin: 0; padding-left: 4mm; }
      .thanks-entry p { margin: 2mm 0 0; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="running-header"><strong>MAVINCI</strong><span>Karta Weselna · dokument operacyjny</span></div>
    <div class="running-footer"><span>Wygenerowano ${escapeHtml(formatDateTime(payload.generatedAt))}</span><span>${escapeHtml(payload.eventName)}</span></div>

    <section class="hero">
      <div class="hero-content">
        <p class="eyebrow">Karta Weselna</p>
        <h1>${escapeHtml(payload.eventName)}</h1>
        ${coupleName ? `<p class="couple">${escapeHtml(coupleName)}</p>` : ''}
        <div class="hero-meta">
          <div><span>Termin</span><strong>${escapeHtml(dateRange || 'Nie uzupełniono')}</strong></div>
          <div><span>Miejsce</span><strong>${escapeHtml(clean(payload.locationName) || 'Nie uzupełniono')}</strong></div>
          <div><span>Liczba gości</span><strong>${escapeHtml(isFilled(guestCount) ? guestCount : 'Nie uzupełniono')}</strong></div>
        </div>
      </div>
    </section>

    <div class="summary">
      <section class="card"><h2>Informacje podstawowe</h2><div class="info-row"><dt>Klient</dt><dd>${escapeHtml(clean(payload.clientName) || coupleName || '—')}</dd></div><div class="info-row"><dt>Adres</dt><dd>${escapeHtml(clean(payload.locationAddress) || '—')}</dd></div></section>
      <section class="card"><h2>Stan karty</h2><div class="status-line"><span>${escapeHtml(STATUS_LABELS[payload.cardStatus] || payload.cardStatus)}</span><strong>${Math.max(0, Math.min(100, payload.cardProgress))}%</strong></div><div class="progress"><span style="width:${Math.max(0, Math.min(100, payload.cardProgress))}%"></span></div></section>
    </div>

    ${payload.people.some((person) => clean(person.firstName)) ? `<section class="section"><div class="section-header"><h2>Najważniejsze osoby</h2></div><div class="people-grid">${renderPeople(payload.people)}</div></section>` : ''}

    ${answerGroups
      .map(({ title, sections }) => {
        if (sections.includes('parents_thanks') && noParentsThanks) {
          return `<section class="section"><div class="section-header"><h2>${escapeHtml(title)}</h2></div><div class="critical-note">Bez podziękowań dla bliskich</div></section>`;
        }
        const groupAnswers = payload.answers.filter((answer) => sections.includes(answer.section) && isFilled(answer.value)
          && !(newWelcome && ['welcome_throwing', 'welcome_glasses'].includes(answer.fieldKey))
          && !(thanksEntries.length && answer.fieldKey === 'parents_thanks_recipients'));
        if (!groupAnswers.length) return '';
        return `<section class="section"><div class="section-header"><h2>${escapeHtml(title)}</h2></div><dl class="info-grid">${renderInfoRows(groupAnswers)}</dl>${sections.includes('parents_thanks') ? thanksHtml : ''}</section>`;
      })
      .join('')}

    ${scheduleRows ? `<section class="section page-break"><div class="section-header"><h2>Harmonogram wesela i posiłków</h2></div><table><thead><tr><th>Termin</th><th>Punkt</th><th>Miejsce</th><th>Odpowiedzialny / uwagi</th></tr></thead><tbody>${scheduleRows}</tbody></table></section>` : ''}

    ${weddingGameRows ? `<section class="section"><div class="section-header"><h2>Wybrane zabawy oczepinowe</h2></div><ul class="choice-list">${weddingGameRows}</ul></section>` : ''}
    ${attractionRows ? `<section class="section"><div class="section-header"><h2>Atrakcje i dodatki</h2></div><ul class="choice-list">${attractionRows}</ul></section>` : ''}
    ${tracksHtml ? `<section class="section"><div class="section-header"><h2>Muzyka</h2></div><div class="tracks">${tracksHtml}</div></section>` : ''}
  </body>
  </html>`;
}
