import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';

export interface PageAnalytics {
  id: string;
  page_url: string;
  page_title: string;
  referrer: string | null;
  user_agent: string | null;
  session_id: string;
  device_type: string | null;
  time_on_page: number;
  created_at: string;
}

export interface ContactFormSubmission {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  source_page: string;
  source_section: string | null;
  city_interest: string | null;
  event_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  status: string;
  created_at: string;
}

export interface AnalyticsStats {
  totalVisits: number;
  uniqueVisitors: number;
  avgTimeOnPage: number;
  contactForms: number;
  topPages: Array<{
    page_url: string;
    visits: number;
    unique_visitors: number;
    avg_time: number;
  }>;
  trafficSources: Array<{
    source: string;
    visits: number;
  }>;
  deviceBreakdown: Array<{
    device_type: string;
    visits: number;
    percentage: number;
  }>;
  topCities: Array<{
    city_interest: string;
    submissions: number;
  }>;
  dailyVisits: Array<{
    date: string;
    visits: number;
  }>;
}

export interface PageStats {
  page_url: string;
  page_title: string;
  visits: number;
  unique_visitors: number;
  avg_time: number;
  bounce_rate: number;
  conversion_rate: number;
  top_referrers: Array<{ referrer: string; count: number }>;
  device_breakdown: Array<{ device_type: string; percentage: number }>;
  daily_visits: Array<{ date: string; visits: number }>;
  contact_forms: ContactFormSubmission[];
}

interface ContactMessageAnalyticsRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  source_page: string;
  category: string;
  status: string;
  notes: string | null;
  created_at: string;
}

const normalizePageUrl = (value?: string | null) => {
  if (!value) return '/';

  let normalized = value.trim();

  try {
    if (/^https?:\/\//i.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    // Zachowaj oryginalną wartość, jeśli historyczny wpis nie jest poprawnym URL-em.
  }

  normalized = normalized.split('?')[0].split('#')[0];
  if (!normalized || normalized === '/') return '/';

  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
};

const isMessageFromPage = (sourcePage: string | null, pageUrl: string) => {
  const normalizedSource = normalizePageUrl(sourcePage).toLocaleLowerCase('pl-PL');
  const normalizedPage = normalizePageUrl(pageUrl).toLocaleLowerCase('pl-PL');

  if (normalizedSource === normalizedPage) return true;
  if (normalizedPage === '/') return false;

  // Starsze formularze zapisywały czasami nazwę sekcji, np. "Konferencje",
  // zamiast pełnej ścieżki "/oferta/konferencje".
  return normalizedSource.split('/').filter(Boolean).at(-1) ===
    normalizedPage.split('/').filter(Boolean).at(-1);
};

const parseLocalDate = (value: string, endOfDay = false) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
};

const getDateBounds = (dateRange: number, customStart?: string, customEnd?: string) => {
  if (customStart && customEnd) {
    return {
      startDate: parseLocalDate(customStart),
      endDate: parseLocalDate(customEnd, true),
    };
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - Math.max(dateRange - 1, 0));

  return { startDate, endDate };
};

const getLocalDateKey = (value: string) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCityFromNotes = (notes: string | null) =>
  notes?.match(/(?:^|\|\s*)City:\s*([^|]+)/i)?.[1]?.trim() || null;

const mapContactMessage = (message: ContactMessageAnalyticsRow): ContactFormSubmission => ({
  id: message.id,
  name: message.name,
  email: message.email,
  phone: message.phone,
  message: message.message,
  source_page: message.source_page,
  source_section: null,
  city_interest: getCityFromNotes(message.notes),
  event_type: message.category,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  referrer: null,
  status: message.status,
  created_at: message.created_at,
});

export const analyticsApi = createApi({
  reducerPath: 'analyticsApi',
  baseQuery: fakeBaseQuery(),
  tagTypes: ['Analytics', 'PageStats', 'ContactForms', 'OnlineUsers'],
  endpoints: (builder) => ({
    getOnlineUsers: builder.query<number, void>({
      async queryFn() {
        try {
          await supabase.rpc('cleanup_stale_sessions');

          const { count, error } = await supabase
            .from('active_sessions')
            .select('*', { count: 'exact', head: true })
            .not('page_url', 'like', '%/crm%');

          if (error) throw error;

          return { data: count || 0 };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['OnlineUsers'],
    }),

    getAnalyticsStats: builder.query<
      AnalyticsStats,
      { dateRange: number; startDate?: string; endDate?: string; pageUrl?: string }
    >({
      async queryFn({ dateRange, startDate: customStart, endDate: customEnd, pageUrl }) {
        try {
          const { startDate, endDate } = getDateBounds(dateRange, customStart, customEnd);
          const normalizedPageUrl = pageUrl ? normalizePageUrl(pageUrl) : undefined;

          let analyticsQuery = supabase
            .from('page_analytics')
            .select('*')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (normalizedPageUrl) {
            analyticsQuery = analyticsQuery.eq('page_url', normalizedPageUrl);
          }

          const { data: analytics, error: analyticsError } = await analyticsQuery;

          if (analyticsError) throw analyticsError;

          const { data: contactMessages, error: messagesError } = await supabase
            .from('contact_messages')
            .select('id, name, email, phone, message, source_page, category, status, notes, created_at')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (messagesError) throw messagesError;

          const forms = ((contactMessages || []) as ContactMessageAnalyticsRow[]).filter(
            (message) => !normalizedPageUrl || isMessageFromPage(message.source_page, normalizedPageUrl),
          );

          // Tabela pomocnicza nadal przechowuje ustrukturyzowane miasto dla części formularzy.
          // Nie używamy jej do licznika, bo te same rekordy są kopiowane do contact_messages.
          const { data: structuredForms, error: structuredFormsError } = await supabase
            .from('contact_form_submissions')
            .select('source_page, city_interest')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (structuredFormsError) {
            console.warn('Nie udało się pobrać danych miast formularzy:', structuredFormsError);
          }

          const relevantStructuredForms = (structuredForms || []).filter(
            (form) => !normalizedPageUrl || isMessageFromPage(form.source_page, normalizedPageUrl),
          );

          const uniqueVisitors = new Set(analytics?.map((a) => a.session_id)).size;
          const timedVisits = (analytics || []).filter((a) => a.time_on_page > 0);
          const avgTime = timedVisits.length
            ? timedVisits.reduce((acc, visit) => acc + visit.time_on_page, 0) / timedVisits.length
            : 0;

          const pageStats = (analytics || []).reduce((acc: any, curr) => {
            if (!acc[curr.page_url]) {
              acc[curr.page_url] = { visits: 0, sessions: new Set(), totalTime: 0, timeCount: 0 };
            }
            acc[curr.page_url].visits++;
            acc[curr.page_url].sessions.add(curr.session_id);
            if (curr.time_on_page > 0) {
              acc[curr.page_url].totalTime += curr.time_on_page;
              acc[curr.page_url].timeCount++;
            }
            return acc;
          }, {});

          const topPages = Object.entries(pageStats)
            .map(([url, data]: [string, any]) => ({
              page_url: url,
              visits: data.visits,
              unique_visitors: data.sessions.size,
              avg_time: data.timeCount > 0 ? Math.round(data.totalTime / data.timeCount) : 0,
            }))
            .sort((a, b) => b.visits - a.visits)
            .slice(0, 10);

          const sourceStats = (analytics || []).reduce((acc: any, curr) => {
            let source = 'Direct';
            if (curr.referrer?.includes('google')) source = 'Google';
            else if (curr.referrer?.includes('facebook')) source = 'Facebook';
            else if (curr.referrer?.includes('linkedin')) source = 'LinkedIn';
            else if (curr.referrer && curr.referrer !== '') source = 'Other';

            acc[source] = (acc[source] || 0) + 1;
            return acc;
          }, {});

          const trafficSources = Object.entries(sourceStats)
            .map(([source, visits]) => ({ source, visits: visits as number }))
            .sort((a, b) => b.visits - a.visits);

          const deviceStats = (analytics || []).reduce((acc: any, curr) => {
            const device = curr.device_type || 'unknown';
            acc[device] = (acc[device] || 0) + 1;
            return acc;
          }, {});

          const totalDevices = analytics?.length || 0;
          const deviceBreakdown = Object.entries(deviceStats)
            .map(([device_type, visits]) => ({
              device_type,
              visits: visits as number,
              percentage: totalDevices
                ? Math.round(((visits as number) / totalDevices) * 100)
                : 0,
            }))
            .sort((a, b) => b.visits - a.visits);

          const dailyStats = (analytics || []).reduce((acc: any, curr) => {
            const date = getLocalDateKey(curr.created_at);
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});

          const dailyVisits = Object.entries(dailyStats)
            .map(([date, visits]) => ({ date, visits: visits as number }))
            .sort((a, b) => a.date.localeCompare(b.date));

          const cityStats = relevantStructuredForms.reduce((acc: any, curr) => {
            if (curr.city_interest) {
              acc[curr.city_interest] = (acc[curr.city_interest] || 0) + 1;
            }
            return acc;
          }, {});

          const topCities = Object.entries(cityStats)
            .map(([city_interest, submissions]) => ({
              city_interest,
              submissions: submissions as number,
            }))
            .sort((a, b) => b.submissions - a.submissions)
            .slice(0, 5);

          return {
            data: {
              totalVisits: analytics?.length || 0,
              uniqueVisitors,
              avgTimeOnPage: Math.round(avgTime),
              contactForms: forms.length,
              topPages,
              trafficSources,
              deviceBreakdown,
              topCities,
              dailyVisits,
            },
          };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['Analytics'],
    }),

    getPageStats: builder.query<PageStats, { pageUrl: string; dateRange: number }>({
      async queryFn({ pageUrl, dateRange }) {
        try {
          const { startDate, endDate } = getDateBounds(dateRange);
          const normalizedPageUrl = normalizePageUrl(pageUrl);

          const { data: analytics, error: analyticsError } = await supabase
            .from('page_analytics')
            .select('*')
            .eq('page_url', normalizedPageUrl)
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (analyticsError) throw analyticsError;

          const { data: contactMessages, error: formsError } = await supabase
            .from('contact_messages')
            .select('id, name, email, phone, message, source_page, category, status, notes, created_at')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (formsError) throw formsError;

          const forms = ((contactMessages || []) as ContactMessageAnalyticsRow[])
            .filter((message) => isMessageFromPage(message.source_page, normalizedPageUrl))
            .map(mapContactMessage);

          const visits = analytics?.length || 0;
          const uniqueVisitors = new Set(analytics?.map((a) => a.session_id)).size;
          const timedVisits = (analytics || []).filter((a) => a.time_on_page > 0);
          const avgTime = timedVisits.length
            ? timedVisits.reduce((acc, visit) => acc + visit.time_on_page, 0) / timedVisits.length
            : 0;

          const bounceRate = visits
            ? ((analytics || []).filter((a) => a.time_on_page < 10).length / visits) * 100
            : 0;

          const conversionRate = uniqueVisitors > 0 ? (forms.length / uniqueVisitors) * 100 : 0;

          const referrerStats = (analytics || []).reduce((acc: any, curr) => {
            const ref = curr.referrer || 'Direct';
            acc[ref] = (acc[ref] || 0) + 1;
            return acc;
          }, {});

          const topReferrers = Object.entries(referrerStats)
            .map(([referrer, count]) => ({ referrer, count: count as number }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

          const deviceStats = (analytics || []).reduce((acc: any, curr) => {
            const device = curr.device_type || 'unknown';
            acc[device] = (acc[device] || 0) + 1;
            return acc;
          }, {});

          const deviceBreakdown = Object.entries(deviceStats)
            .map(([device_type, count]) => ({
              device_type,
              percentage: visits ? Math.round(((count as number) / visits) * 100) : 0,
            }))
            .sort((a, b) => b.percentage - a.percentage);

          const dailyStats = (analytics || []).reduce((acc: any, curr) => {
            const date = getLocalDateKey(curr.created_at);
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});

          const dailyVisits = Object.entries(dailyStats)
            .map(([date, visits]) => ({ date, visits: visits as number }))
            .sort((a, b) => a.date.localeCompare(b.date));

          return {
            data: {
              page_url: normalizedPageUrl,
              page_title: analytics?.[0]?.page_title || normalizedPageUrl,
              visits,
              unique_visitors: uniqueVisitors,
              avg_time: Math.round(avgTime || 0),
              bounce_rate: Math.round(bounceRate),
              conversion_rate: Math.round(conversionRate * 100) / 100,
              top_referrers: topReferrers,
              device_breakdown: deviceBreakdown,
              daily_visits: dailyVisits,
              contact_forms: forms,
            },
          };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['PageStats'],
    }),

    getAllPages: builder.query<
      Array<{ url: string; title: string; visits: number }>,
      { dateRange: number }
    >({
      async queryFn({ dateRange }) {
        try {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - dateRange);

          const { data: analytics, error } = await supabase
            .from('page_analytics')
            .select('page_url, page_title')
            .gte('created_at', startDate.toISOString());

          if (error) throw error;

          const pageStats = (analytics || []).reduce((acc: any, curr) => {
            if (!acc[curr.page_url]) {
              acc[curr.page_url] = { title: curr.page_title || curr.page_url, visits: 0 };
            }
            acc[curr.page_url].visits++;
            return acc;
          }, {});

          const pages = Object.entries(pageStats)
            .map(([url, data]: [string, any]) => ({
              url,
              title: data.title,
              visits: data.visits,
            }))
            .sort((a, b) => b.visits - a.visits);

          return { data: pages };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: ['Analytics'],
    }),
  }),
});

export const {
  useGetAnalyticsStatsQuery,
  useGetPageStatsQuery,
  useGetAllPagesQuery,
  useGetOnlineUsersQuery,
} = analyticsApi;
