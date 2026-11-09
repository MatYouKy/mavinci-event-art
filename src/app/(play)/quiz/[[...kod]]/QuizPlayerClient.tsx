'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

/**
 * Gracz quizu Mavinci LIVE na telefonie (mavinci.pl/quiz/KOD).
 * Dołączenie i naciśnięcia idą funkcjami bazy (bez konta), stan przycisków przychodzi przez
 * prywatny kanał Realtime sesji, który wypełnia aplikacja prowadzącego.
 */

interface PlayState {
  title?: string;
  mode: 'idle' | 'choice' | 'buzz' | 'bid';
  answers: string[];
  collecting: boolean;
  message?: string;
  closed?: boolean;
  rev?: number;
}

interface PlayerSession {
  code: string;
  token: string;
  topic: string;
  playerNo: number;
  name: string;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LETTER_COLORS = ['bg-[#e11d48]', 'bg-[#2563eb]', 'bg-[#d97706]', 'bg-[#16a34a]', 'bg-[#7c3aed]', 'bg-[#0891b2]'];
const STORAGE_KEY = 'mavinciQuizPlayer';
const BID_FLUSH_MS = 400;

const IDLE: PlayState = { mode: 'idle', answers: [], collecting: false, message: 'Czekaj na start gry' };

function loadSaved(code: string): PlayerSession | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as PlayerSession | null;
    return saved && saved.code === code ? saved : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  const message = (error as { message?: string })?.message || '';
  return message || 'Brak połączenia. Spróbuj ponownie.';
}

export default function QuizPlayerClient({ initialCode }: { initialCode: string }) {
  const supabase = useMemo(
    () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    }),
    [],
  );

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [player, setPlayer] = useState<PlayerSession | null>(null);
  const [state, setState] = useState<PlayState>(IDLE);
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [taps, setTaps] = useState(0);
  const [sent, setSent] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pendingTaps = useRef(0);

  // Nowe pytanie albo zmiana etapu = czyścimy zaznaczenie i licznik stuknięć.
  const questionKey = `${state.mode}|${state.title ?? ''}|${state.answers.join('|')}`;
  useEffect(() => {
    setPicked(null);
    setTaps(0);
    setSent(false);
  }, [questionKey]);
  // Kolejna runda zgłoszeń („Kto pierwszy” po złej odpowiedzi) — przycisk znowu aktywny.
  useEffect(() => {
    if (state.collecting) setSent(false);
  }, [state.collecting]);

  const join = useCallback(async (joinCode: string, joinName: string, token?: string) => {
    setJoining(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('mavinci_online_join', {
      p_code: joinCode,
      p_name: joinName,
      p_token: token ?? null,
    });
    setJoining(false);
    if (rpcError || !data) {
      if (token) localStorage.removeItem(STORAGE_KEY);
      setError(errorText(rpcError));
      return;
    }
    const session: PlayerSession = {
      code: joinCode,
      token: data.token,
      topic: data.topic,
      playerNo: data.playerNo,
      name: data.name,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setPlayer(session);
    setState({ ...IDLE, ...(data.state as PlayState) });
  }, [supabase]);

  // Powrót po odświeżeniu strony: ten sam gracz.
  useEffect(() => {
    if (!initialCode) return;
    const saved = loadSaved(initialCode);
    if (saved) void join(initialCode, saved.name, saved.token);
  }, [initialCode, join]);

  const refreshState = useCallback(async () => {
    if (!player) return;
    const { data } = await supabase.rpc('mavinci_online_state', { p_token: player.token });
    if (data) setState({ ...IDLE, ...(data as PlayState) });
  }, [player, supabase]);

  // Kanał stanu: prywatny, tylko odbiór.
  useEffect(() => {
    if (!player) return undefined;
    const channel = supabase
      .channel(player.topic, { config: { private: true } })
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        const next = payload as PlayState;
        setState((current) => (next.rev != null && current.rev != null && next.rev < current.rev ? current : { ...IDLE, ...next }));
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        // Po (ponownym) połączeniu dociągamy stan, który mógł przyjść w przerwie.
        if (status === 'SUBSCRIBED') void refreshState();
      });
    channelRef.current = channel;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshState();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [player, supabase, refreshState]);

  const press = useCallback(async (answer: string, count = 1) => {
    if (!player) return;
    const { data, error: rpcError } = await supabase.rpc('mavinci_online_press', {
      p_token: player.token,
      p_answer: answer,
      p_taps: count,
    });
    if (rpcError) {
      setError(errorText(rpcError));
      return;
    }
    setError('');
    if (data?.ok) setSent(true);
    if (data?.reason === 'closed') setState({ ...IDLE, closed: true, message: 'Gra zakończona. Dziękujemy!' });
  }, [player, supabase]);

  // Licytacja: stuknięcia wysyłamy paczkami, żeby nie zalać serwera.
  useEffect(() => {
    if (state.mode !== 'bid' || !state.collecting) return undefined;
    const id = window.setInterval(() => {
      const count = pendingTaps.current;
      if (count <= 0) return;
      pendingTaps.current = 0;
      void press('QUIZ', Math.min(count, 60));
    }, BID_FLUSH_MS);
    return () => {
      window.clearInterval(id);
      const rest = pendingTaps.current;
      pendingTaps.current = 0;
      if (rest > 0) void press('QUIZ', Math.min(rest, 60));
    };
  }, [state.mode, state.collecting, press]);

  const vibrate = (ms: number) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  };

  const leave = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPlayer(null);
    setState(IDLE);
  };

  // ── Ekran dołączania ──
  if (!player) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6 py-10">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-[#d3bb73]">Mavinci LIVE</p>
          <h1 className="mt-2 text-3xl font-semibold">Dołącz do gry</h1>
          <p className="mt-2 text-sm text-[#e5e4e2]/60">Kod gry jest na ekranie. Imię zobaczy prowadzący.</p>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!cleanCode || !name.trim()) {
              setError('Podaj kod gry i imię.');
              return;
            }
            void join(cleanCode, name.trim());
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="KOD GRY"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={8}
            className="rounded-xl bg-[#1c1f33] px-4 py-4 text-center text-2xl font-semibold tracking-[0.4em] outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/50"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Twoje imię"
            maxLength={40}
            autoComplete="given-name"
            className="rounded-xl bg-[#1c1f33] px-4 py-4 text-lg outline-none ring-1 ring-white/5 focus:ring-[#d3bb73]/50"
          />
          <button
            type="submit"
            disabled={joining}
            className="rounded-xl bg-[#d3bb73] py-4 text-lg font-semibold text-[#1c1f33] disabled:opacity-60"
          >
            {joining ? 'Dołączam…' : 'Dołącz'}
          </button>
          {error && <p className="text-center text-sm text-[#fca5a5]">{error}</p>}
        </form>
      </main>
    );
  }

  const open = state.collecting && !state.closed;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="flex items-center justify-between bg-[#1c1f33] px-5 py-3">
        <span className="text-xs uppercase tracking-[0.3em] text-[#d3bb73]">Mavinci LIVE</span>
        <span className="flex items-center gap-2 text-sm">
          <i className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-[#4ade80]' : 'bg-[#f59e0b]'}`} />
          {player.name} · #{player.playerNo}
        </span>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-5 px-5 py-6">
        {state.title && <h1 className="text-center text-xl font-semibold">{state.title}</h1>}

        {state.mode === 'choice' && (
          <>
            <div className={`grid gap-3 ${state.answers.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {state.answers.map((answer, index) => {
                const letter = LETTERS[index];
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!open}
                    onClick={() => {
                      setPicked(letter);
                      vibrate(30);
                      void press(letter);
                    }}
                    className={`flex min-h-[110px] flex-col items-center justify-center gap-1 rounded-2xl px-3 py-4 text-white transition ${LETTER_COLORS[index]} ${
                      picked === letter ? 'scale-[1.02] shadow-[0_0_0_4px_rgba(255,255,255,0.85)]' : ''
                    } ${open ? '' : 'opacity-35'}`}
                  >
                    <span className="text-4xl font-bold">{letter}</span>
                    {answer && <span className="text-center text-sm leading-tight">{answer}</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-center text-[#e5e4e2]/70">
              {open ? (picked ? `Wybrano ${picked} — możesz zmienić` : state.message || 'Wybierz odpowiedź') : 'Czekaj na start odpowiedzi'}
            </p>
          </>
        )}

        {(state.mode === 'buzz' || state.mode === 'bid') && (
          <>
            <button
              type="button"
              disabled={!open}
              onClick={() => {
                if (state.mode === 'bid') {
                  pendingTaps.current += 1;
                  setTaps((value) => value + 1);
                  vibrate(15);
                } else {
                  vibrate(40);
                  void press('QUIZ');
                }
              }}
              className={`mx-auto flex aspect-square w-[78%] items-center justify-center rounded-full bg-[#e11d48] text-2xl font-bold uppercase text-white shadow-[0_12px_40px_rgba(225,29,72,0.45)] active:scale-95 ${
                open ? '' : 'opacity-35'
              }`}
            >
              {state.mode === 'bid' ? 'Stukaj!' : 'Zgłaszam się'}
            </button>
            {state.mode === 'bid' && <p className="text-center text-4xl font-bold text-[#d3bb73]">{taps}</p>}
            <p className="text-center text-[#e5e4e2]/70">
              {open
                ? state.mode === 'bid'
                  ? 'Stukaj jak najszybciej — im więcej, tym wyższa stawka'
                  : sent
                    ? 'Zgłoszenie wysłane'
                    : 'Naciśnij, gdy znasz odpowiedź'
                : 'Czekaj na sygnał prowadzącego'}
            </p>
          </>
        )}

        {state.mode === 'idle' && (
          <p className="text-center text-lg text-[#e5e4e2]/80">{state.message || 'Czekaj na pytanie'}</p>
        )}

        {error && <p className="text-center text-sm text-[#fca5a5]">{error}</p>}
      </section>

      {state.closed && (
        <button type="button" onClick={leave} className="mx-5 mb-6 rounded-xl bg-[#1c1f33] py-3 text-sm text-[#e5e4e2]/70">
          Dołącz do innej gry
        </button>
      )}
    </main>
  );
}
