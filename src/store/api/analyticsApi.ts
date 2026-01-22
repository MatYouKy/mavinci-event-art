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
      { dateRange: number; startDate?: string; endDate?: string }
    >({
      async queryFn({ dateRange, startDate: customStart, endDate: customEnd }) {
        try {
          let startDate: Date;
          let endDate: Date = new Date();

          if (customStart && customEnd) {
            startDate = new Date(customStart);
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
          } else {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - dateRange);
          }

          const { data: analytics, error: analyticsError } = await supabase
            .from('page_analytics')
            .select('*')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (analyticsError) throw analyticsError;

          const { data: forms, error: formsError } = await supabase
            .from('contact_form_submissions')
            .select('*')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          if (formsError) throw formsError;

          const uniqueVisitors = new Set(analytics?.map((a) => a.session_id)).size;
          const avgTime =
            analytics
              ?.filter((a) => a.time_on_page > 0)
              .reduce((acc, a) => acc + a.time_on_page, 0) /
            (analytics?.filter((a) => a.time_on_page > 0).length || 1);

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

          const totalDevices = analytics?.length || 1;
          const deviceBreakdown = Object.entries(deviceStats)
            .map(([device_type, visits]) => ({
              device_type,
              visits: visits as number,
              percentage: Math.round(((visits as number) / totalDevices) * 100),
            }))
            .sort((a, b) => b.visits - a.visits);

          const dailyStats = (analytics || []).reduce((acc: any, curr) => {
            const date = new Date(curr.created_at).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});

          const dailyVisits = Object.entries(dailyStats)
            .map(([date, visits]) => ({ date, visits: visits as number }))
            .sort((a, b) => a.date.localeCompare(b.date));

          const cityStats = (forms || []).reduce((acc: any, curr) => {
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
              avgTimeOnPage: Math.round(avgTime || 0),
              contactForms: forms?.length || 0,
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
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - dateRange);

          const { data: analytics, error: analyticsError } = await supabase
            .from('page_analytics')
            .select('*')
            .eq('page_url', pageUrl)
            .gte('created_at', startDate.toISOString());

          if (analyticsError) throw analyticsError;

          const { data: forms, error: formsError } = await supabase
            .from('contact_form_submissions')
            .select('*')
            .ilike('source_page', `%${pageUrl.split('/').pop()}%`)
            .gte('created_at', startDate.toISOString());

          if (formsError) throw formsError;

          const visits = analytics?.length || 0;
          const uniqueVisitors = new Set(analytics?.map((a) => a.session_id)).size;
          const avgTime =
            analytics
              ?.filter((a) => a.time_on_page > 0)
              .reduce((acc, a) => acc + a.time_on_page, 0) /
            (analytics?.filter((a) => a.time_on_page > 0).length || 1);

          const bounceRate = analytics
            ? (analytics.filter((a) => a.time_on_page < 10).length / visits) * 100
            : 0;

          const conversionRate = visits > 0 ? ((forms?.length || 0) / uniqueVisitors) * 100 : 0;

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
              percentage: Math.round(((count as number) / visits) * 100),
            }))
            .sort((a, b) => b.percentage - a.percentage);

          const dailyStats = (analytics || []).reduce((acc: any, curr) => {
            const date = new Date(curr.created_at).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});

          const dailyVisits = Object.entries(dailyStats)
            .map(([date, visits]) => ({ date, visits: visits as number }))
            .sort((a, b) => a.date.localeCompare(b.date));

          return {
            data: {
              page_url: pageUrl,
              page_title: analytics?.[0]?.page_title || pageUrl,
              visits,
              unique_visitors: uniqueVisitors,
              avg_time: Math.round(avgTime || 0),
              bounce_rate: Math.round(bounceRate),
              conversion_rate: Math.round(conversionRate * 100) / 100,
              top_referrers: topReferrers,
              device_breakdown: deviceBreakdown,
              daily_visits: dailyVisits,
              contact_forms: forms || [],
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
