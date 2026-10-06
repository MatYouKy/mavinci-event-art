import { systemEmailThemeHead, gmailWhiteText } from '../_shared/emailTheme.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Definicje lokalne: ta funkcja musi dać się wdrożyć z samego index.ts
// w edytorze Supabase (bez dostępu do katalogu ../_shared).
// Paleta wiadomości systemowych. PNG trafiają przez send-email do załączników
// inline (CID), aby nie zależeć od obsługi SVG ani zdalnego pobierania ikon.
const EMAIL_BRAND = {
  background: '#1b0710',
  surface: '#351020',
  panel: '#46172b',
  gold: '#d3bb73',
  text: '#f3e9ed',
  cream: '#faf6f7',
} as const;

const EMAIL_ICONS: Record<string, string> = {
  calendar:
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAACZUlEQVRoge1ZvW7UQBBeCQpQHoC/AngWKiSKNCivwFEAmYGCKhUo4lHSEim6GZ+cSJD2LjsclDRBClIiKKAgKUDjc4Lt2Lf+PZvgTxrpdKvZ/b7dmVl7bEyPHj0KQRgeWIYvavq7a/M5IYT7wvg7MML9rs3nxNlioXVtvosjwPfXLgvDQBh2hPBAGL4nF2vMCL/N1sRt5aBcCpEfe6u3LOH7hRHm+WYZ3n2iFzdz77w6tE1aUkTkOglhfNw2Wck0GOQQADsx5YRvx1tP70yGuGQWhMkQl3RNYdhMiNh2OgvD16jTdIS3TUsYByJiyX3gdBKGn1Gnz/7aFdMSdndXryZC6IfTSQiPo04bGw8vmZbgB6U8lsi/nE7tJyrOtV6A9CeAiw0h0zKk6ON25wRwwReergkojAsvQMIjLZOAC3nvFZeAaFKVsRyJ+HHr2Q1hWBcCDoxh/YP//Po/IcB6sGwZj86fHh7teXi/0yEkDCtCcJLpT3DoPIm2klgc5P+eILzunABJI09wYgkfWcaXiRCkTgmQDPL6fzg+6KwAcZM/N24ZXzWaxHlrfSnyBIfWe3Kt+TLqKJVlyIvmhAfLro1pXEBZ8hKOVxdQIYT2CO4l37mlTvLhDscWKNyXnANLMG2UvEJbF9FJtLVhasBkiHcbJ68Iu8K1N7YCkvFw82onP5tQW9rRhWCzjtaiJXiTKIkaTl6t5FNvvoKWlcSWYeSuXlCNfG3t9ZQyqpeQw+e4MvlT6MeESiJSBMy7PyzBVEusqROnn5gsgV/kE1NWCJ11F/RxgGE0ywlY0epUK/EePf4z/AHha+2BTYC05gAAAABJRU5ErkJggg==',
  location:
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAADWElEQVRogdVZS2gUQRBtQfEL/j8gRL0KXlREBE9+Dh7Ei6JgvIgeAkmcqg0bRF3Fi4oi6CHqQQ+RIPEgqESna5a9SESymN3uUUIQRNRo9GSMEJW40huTmJiY7pme2d0HBXMYat7rrqqurmHMEl5S42JJziFJeEsSdgiOnyXHH8qKz4QdkuCm5FjtP3YWsXKB4Mc2Cg53BcF3SVjQsT/vtgoXN5SMuJ9JrBCELbqkJxTC8ZfkeFt4dctjJS8osV0S9IYhP8Y4fsxz2BYL+WKcc/hpjTyNiFD5Uh0teQ/3C4JB6+RpJDcGBcd90SUr4UBU5OWICBzIew3rrZJvb3dmCw6voiYvR3ei+3UmNcuaAMHhbFzk5aidtkJeHTqCQ1/cAgSHPvGwcaGF1cdkwFjuEQTpIcOeQEI4JGwI8A2J51RNLxTYtGEf6ll4sEMSCkMB+VDkfUpWGSafm72fmjOZv5yLcyUHMvHZ6TkrQ9V9k5DJUnL+VD47M/UL1MmrnwsY/FyQBGeiiFeTvBIcUsEFcLyu+yHfw7W6fvPkrNNfGLwWXABhs+6HdMJnTBjp50FzCAFwVXsHKFmlLeBR/WqDHbgSQgA2aAvgcEDXr3CdgwZJjIEF5L2GrQYfevZ37Z8M6h1J+FR7B9KwJbAA1VBJgn6DSnR8Kp+S8ITBonztbqudycJAcLxjkHAqZi+pA2u8Hz9TM08QXDbxJQhbQpEvCvBgj5GAoqnrJjQJglpBWKdKoST8ZOrH57A7tIBMJjVdcnxnLiKcCYL32ezRGcwGVG9eAgEnmS10ZWCJSqj4BEB/zsVlzCYkwcUYBZxjtqGGT5LgW0Wu/jBUiYw89jmeZ1GOE6PdBeh/3la7lEWJKCcUguMpFjXUlVEQvLEugMPbiU7wSKBmmLYF+AbdbGgUpwwETyyufrtOJ2sVee5sLs73w8Y9waDvOZtYKSAIblioPE2sVFD3YNV0Ba868MHK+DAMVPKFELCXlQMExwcBEreNlQtyLq4x6VbV5NlkihELJGGNfs1PHGHlhsLQ2eBqlM107DVfFy/SuOp/P0ME4ZeyC53xUOEx6Q54eJhVAiRh679VB++xSkGXukOP+a0EvZHdsqKCdBM7Va80ZM4uVokQHC4oi/IbvwGgjs45oruOFwAAAABJRU5ErkJggg==',
  user: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABbklEQVRoge1YW07DMBD0VZCAW8AHtAdit70Lr4MQbyjpDZp1abgDIhIq/0VuQEIIiTg2WkfsSPOTrxmvvRmNMQpFXuASpkx44yw8OYK3jtgwwTXTbGJyxYrg2BEsHeHuF1aPdn5kckJd4KkjaHuI/yC0dTk/MRmdfID4jkz4sr67OJTWb9jiIlT8l0ksZcWXMB0uvmNt4VzOgIXbWAPO4pWYgW5VRhogbMQMsMVtrAG2uB23AcLXUV8hJtyIGdhHhvhHfCloYDaJNbAu8EzMQGcC7iMMVEYaqwIP2OLzaKOEhw9mXlCI+GzC3Cd8RGYLDz32/iKbk/8JPtv4eODXo/9P7Em48d/EH6xCoVDk1vngLg3hb7ujgM4nFatk3VF455NsKm103Bja+aQixwa+uM4n2SSWYp1PKtZDuqMknU8q2gHdUaLOJxUbkcokFXlIdyQt2n2jGnA6AdQrFATpK+P0EZP8qbt/vUYVCtML77cvaZWv6SlcAAAAAElFTkSuQmCC',
  checklist:
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABhklEQVRoge2YsU7DMBCGLbUvAIIHQOywMPIaXZiYKyFRXwa2bixI8AwwoSwsCKVnqrwBor4OLAxlhJmyAXKlqFVohB3S2KX3SR6r/F/t8x9FCIZhmKAgBV+LWFU9T7CA4h2o9wiJBUMskGPldyCOWw2zxDIeoThuNTTCpUa4TtNuU/iAHAT07claPnz2O63klctOVIZDg7ZJwau+j3by4acScCZCFCAFbY3wOQmJ8EYINz/Dy9FjD7aCExgquZ+FL1ou4cnHEBPK0+Lw8EL9aDv4W4jmSLiG936NzkqUCR9EDxiJsuGDEDA8pXJjZZuYfApU0cTk7RaqqInJSw9U2MRUtwA3cTAzgNzEE7z3wL9r4qUU+AuEMLYWQBgHJzBQ0YGtwKAnD4MTMGglL34Lr1GeCxt8CMTmVURBUhheyb71ZxrXoSq78s8dJp11QnieE370cHe0af1v+BIwUNLZJSXfZ47Nh8bjPeGCT4H8UFsNbWgC2VBbD22IpGm36e3bKsMwola+AU1HHQRaP1atAAAAAElFTkSuQmCC',
  info: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAADUUlEQVRogd1aW08TURDeF/XZS7w/GOMtavSXeNdE33wBHxTbzmwBn/wDBIX/4As88KJAZ5bwgvFCFTpnATXiLzAaCsYbATPbSltpK+6etqyTTNL07M75vjOzs3PmrONYkDlK7/cJbhjCfmHIGMJ5w/DJMC4XVH/Dh+JYv/Hwut7jtFJmuXunIUgI4QvDuBpGRe8lSKitpgHPjXceDFaRYSks8PUKS4agb8pLHWgYcH/g/lZhvGcXOP7pkUUh7NK5rIKfZjgmhK8bBdysJ+LPjCVPWQEvGfeSrkyzwJs1EpAXDy5GAp/LwE1D8LPZ4E1Jl8VL3Qq38oztLQS+Wq4+uW3/BN4QXi7m8HDuZ1ww5CZlFE6o5hhTGhJRPJFj98LGwmYsfTxKzCtQfeirJ4LwJIQgP0Ppo3XBvxvu2CYMU1HcLQxQ27PgRgynbN0UW8jzEePVw5O17GtqtPBMpGu/YS28pOrl7+kMno5qXwjysyPJfVXcq+VB5NVZNR501vYwdNuYQwh6Kwy/GYddhuGLFQIMS9W8UAgfO2WIEC76o6kdZavvJu2AL5HQ1RbPPWNGU2eLNZSlBcLfJO6UXEvw0i6BxqsQPg3AawnbajAmHIEV8e7ucYKdlFXD8NUQDhnGgQolHArG7M51zV72KRkdrJmFCAatzsXwQAmQXffCo1oEdMzqXATDSmA+vgTwrRL4HFcCQvBRCfyILQHGbzEnAN/jH0JC8D7WD7Fouy+uBBif6C6pL64ERMtqbbTGlYDh1JWgs6yFUdwICOHKdAZ3B4aF4XnsCDBMlAwTJOJGwM/A7cpev7Wuc+MJCEG+YktZCCN8GBcChqFnnXHdmdnpQjeWgNRqqwReIOza7AQMgVv3FMYQvNrEBCb/enrjj6aOBN3lTUZACBe18exsRLSVHaG9PqldZOHk4XLV/3QspM1ln+D8hsCveYLctujPQ4sOOP6LI6bycIp4uhIu5hkXTAbPOTZkaiRxyDA+ayKBrCYTx6YEKdaDzkZ6QxgXhBCz2fYtTqOkUH5Dr82zYwkWBXr8cXev0yzRYkoYOrRLHGY/ETRnGSa0qpTH3dubBryaaJfY9/CqekbbfYZxTj+x0baHavHTmzkd02v02rXNSET5BWYC2x9IKjh/AAAAAElFTkSuQmCC',
};

const renderEmailIcon = (name: keyof typeof EMAIL_ICONS): string => {
  const png = EMAIL_ICONS[name];
  if (!png) return '';
  return `<img src="data:image/png;base64,${png}" width="16" height="16" alt="" role="presentation" style="display:block;width:16px;height:16px;border:0;outline:none;">`;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const DEFAULT_EMAIL_LOGO_URL =
  'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/company-logos/brandbook/d4474f90-5e61-4ba4-928e-c25c0f0659b5/1779367661905.png';

const toPublicCompanyLogoUrl = (value: string, supabaseUrl: string): string => {
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${supabaseUrl}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
};

interface EventInvitationRequest {
  assignmentId: string;
  includePhases?: boolean;
  mode?: 'invitation' | 'timeline_update';
}

const escapeLocationHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log('[send-event-invitation] Starting...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      assignmentId,
      includePhases = true,
      mode = 'invitation',
    }: EventInvitationRequest = await req.json();
    console.log('[send-event-invitation] Assignment ID:', assignmentId);

    if (!assignmentId) {
      throw new Error('Assignment ID is required');
    }
    if (mode !== 'invitation' && mode !== 'timeline_update') {
      throw new Error('Unsupported email mode');
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('employee_assignments')
      .select(
        `
        id,
        status,
        role,
        responsibilities,
        invitation_token,
        invitation_expires_at,
        invitation_email_sent,
        invited_by,
        employee_id,
        event_id,
        employees!employee_assignments_employee_id_fkey(
          id,
          auth_user_id,
          name,
          surname,
          email,
          personal_email,
          notification_email_preference
        ),
        events(
          id,
          created_by,
          name,
          event_date,
          event_end_date,
          location,
          location_room_ids,
          stage_room_id,
          venue:locations!location_id(name, formatted_address, rooms),
          description,
          my_company_id,
          event_categories(name, color)
        )
      `,
      )
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      console.error('[send-event-invitation] Assignment not found:', assignmentError);
      throw new Error('Assignment not found');
    }

    const employee = (Array.isArray(assignment.employees)
      ? assignment.employees[0] : assignment.employees) as any;
    const event = (Array.isArray(assignment.events)
      ? assignment.events[0] : assignment.events) as any;
    if (!employee || !event) throw new Error('Assignment employee or event not found');

    // Defense in depth for older clients/assignments. Do not send an invitation
    // to the event author, a self-invited member, or an already accepted member.
    // An explicitly requested supplementary timeline email remains available.
    const recipientIds = [employee.id, employee.auth_user_id].filter(Boolean);
    const isAuthor = !!event.created_by && recipientIds.includes(event.created_by);
    const isSelfInvited = !!assignment.invited_by && recipientIds.includes(assignment.invited_by);
    if (mode === 'invitation' && (isAuthor || isSelfInvited || assignment.status === 'accepted')) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: isAuthor ? 'event_author' : isSelfInvited ? 'self_assignment' : 'already_accepted',
        message: 'Zaproszenie nie jest potrzebne — nie wysłano wiadomości.',
        sentTo: [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let phaseAssignments: any[] = [];
    let phasesError: any = null;
    if (includePhases) {
      const phaseResult = await supabase
        .from('event_phase_assignments')
        .select(
          `
          phase_id,
          assignment_start,
          assignment_end,
          phase_work_start,
          phase_work_end,
          event_phases!inner(
            id,
            name,
            start_time,
            end_time,
            color,
            event_id
          )
        `,
        )
        .eq('employee_id', assignment.employee_id)
        .eq('event_phases.event_id', assignment.event_id);
      phaseAssignments = phaseResult.data || [];
      phasesError = phaseResult.error;
    }

    if (phasesError) {
      console.error('[send-event-invitation] Error fetching phases:', phasesError);
    }

    console.log('[send-event-invitation] Found phase assignments:', phaseAssignments?.length || 0);

    console.log('[send-event-invitation] Assignment status:', assignment.status);

    if (mode === 'invitation' && assignment.status !== 'pending') {
      throw new Error('Can only send invitations for pending assignments');
    }
    if (mode === 'timeline_update' && assignment.status === 'rejected') {
      throw new Error('Cannot send a timeline update to a rejected assignment');
    }
    if (mode === 'timeline_update' && phaseAssignments.length === 0) {
      throw new Error('No timeline phases are assigned to this employee');
    }

    const venue = Array.isArray(event.venue) ? event.venue[0] : event.venue;
    const roomDescription = (venue?.rooms || [])
      .filter((room: any) => (event.location_room_ids || []).includes(room.id))
      .map(
        (room: any) =>
          `${room.name}${room.id === event.stage_room_id ? ' — scena / DJ' : ''}${room.notes ? ` (${room.notes})` : ''}`,
      )
      .join('; ');
    const locationText =
      [venue?.name, venue?.formatted_address].filter(Boolean).join(' · ') ||
      (typeof event.location === 'string' ? event.location.trim() : '');
    const locationQuery = encodeURIComponent(locationText);
    const googleMapsLocationUrl = `https://www.google.com/maps/search/?api=1&query=${locationQuery}`;
    const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${locationQuery}&travelmode=driving`;
    const appleMapsDirectionsUrl = `https://maps.apple.com/?daddr=${locationQuery}&dirflg=d`;

    let emailLogoUrl = DEFAULT_EMAIL_LOGO_URL;
    if (event?.my_company_id) {
      const { data: defaultBrandbookLogo } = await supabase
        .from('company_brandbook_logos')
        .select('url')
        .eq('company_id', event.my_company_id)
        .eq('is_default', true)
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultBrandbookLogo?.url) {
        emailLogoUrl = toPublicCompanyLogoUrl(defaultBrandbookLogo.url, supabaseUrl);
      }
    }

    console.log('[send-event-invitation] Employee email:', employee?.email);
    console.log('[send-event-invitation] Employee personal_email:', employee?.personal_email);
    console.log(
      '[send-event-invitation] Email preference:',
      employee?.notification_email_preference,
    );

    const notificationEmails: string[] = [];
    const preference = employee?.notification_email_preference || 'work';

    switch (preference) {
      case 'work':
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
        break;

      case 'personal':
        if (employee?.personal_email) {
          notificationEmails.push(employee.personal_email);
        }
        break;

      case 'both':
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
        if (employee?.personal_email) {
          notificationEmails.push(employee.personal_email);
        }
        break;

      case 'none':
        break;

      default:
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
    }

    console.log('[send-event-invitation] Will send to emails:', notificationEmails);

    if (notificationEmails.length === 0) {
      console.log('[send-event-invitation] No emails to send based on preference');

      await supabase
        .from('employee_assignments')
        .update({
          invitation_email_sent: false,
          invitation_email_sent_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'No email sent due to employee preferences',
          preference: preference,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (mode === 'invitation' && !assignment.invitation_token) {
      throw new Error('Invitation token not generated');
    }

    const frontendUrl = Deno.env.get('FRONTEND_URL') || 'https://mavinci.pl';
    console.log('[send-event-invitation] Frontend URL:', frontendUrl);

    const acceptUrl = `${frontendUrl}/invitation/accept?token=${assignment.invitation_token}`;
    const rejectUrl = `${frontendUrl}/invitation/reject?token=${assignment.invitation_token}`;
    const eventUrl = `${frontendUrl}/crm/events/${event.id}`;

    const eventDateFormatted = new Date(event.event_date).toLocaleDateString('pl-PL', {
      timeZone: 'Europe/Warsaw',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const expiresAt = new Date(assignment.invitation_expires_at).toLocaleDateString('pl-PL', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Sortujemy po tych samych terminach, które pokazujemy w tabeli.
    // Pełne daty zachowują kolejność także przy pracy przez północ.
    const phaseSortTime = (value: string | null | undefined): number => {
      const timestamp = value ? Date.parse(value) : NaN;
      return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
    };
    const chronologicalPhases = phaseAssignments
      .map((phase: any, index: number) => ({
        phase,
        index,
        start: phase.phase_work_start || phase.assignment_start || phase.event_phases.start_time,
        end: phase.phase_work_end || phase.assignment_end || phase.event_phases.end_time,
      }))
      .sort(
        (a, b) =>
          phaseSortTime(a.start) - phaseSortTime(b.start) ||
          phaseSortTime(a.end) - phaseSortTime(b.end) ||
          a.index - b.index,
      );

    const phasesTableHtml =
      chronologicalPhases.length > 0
        ? `<div style="margin: 30px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
    <tr>
      <td style="vertical-align:middle;padding-right:8px;">
        ${renderEmailIcon('checklist')}
      </td>
      <td style="vertical-align:middle;">
        <span style="font-size:18px; font-weight:600; color:#d3bb73;">
          Twoje przypisane fazy
        </span>
      </td>
    </tr>
  </table>

  <div style="background: rgba(211, 187, 115, 0.05); border: 1px solid rgba(211, 187, 115, 0.1); border-radius: 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
      <thead>
        <tr style="background: rgba(211, 187, 115, 0.15);">
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Faza
          </th>
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Rozpoczęcie pracy
          </th>
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Zakończenie pracy
          </th>
        </tr>
      </thead>
      <tbody>
        ${chronologicalPhases
          .map(({ phase, start, end }) => {
            const phaseData = phase.event_phases;
            const workStart = new Date(start).toLocaleString('pl-PL', {
              timeZone: 'Europe/Warsaw',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const workEnd = new Date(end).toLocaleString('pl-PL', {
              timeZone: 'Europe/Warsaw',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return `
            <tr style="border-bottom: 1px solid rgba(211, 187, 115, 0.1);">
              <td style="padding: 10px; font-size: 13px; color: #e5e4e2; font-weight: 500;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:8px; vertical-align:middle;">
                      <div style="width:8px; height:8px; border-radius:50%; background:${phaseData.color || EMAIL_BRAND.gold};"></div>
                    </td>
                    <td style="vertical-align:middle; font-size:13px; color:#e5e4e2; font-weight:500;">
                      ${phaseData.name}
                    </td>
                  </tr>
                </table>
              </td>
              <td style="padding: 10px; font-size: 13px; color: rgba(229, 228, 226, 0.8);">
                ${workStart}
              </td>
              <td style="padding: 10px; font-size: 13px; color: rgba(229, 228, 226, 0.8);">
                ${workEnd}
              </td>
            </tr>
          `;
          })
          .join('')}
      </tbody>
    </table>
  </div>

  <p style="margin: 10px 0 0; font-size: 12px; color: rgba(229, 228, 226, 0.5); text-align: center;">
    Godziny pracy w poszczególnych fazach wydarzenia
  </p>
</div>`
        : mode === 'invitation'
          ? `
  <div style="margin:24px 0;padding:16px;border:1px solid rgba(211,187,115,.18);border-radius:8px;background:rgba(211,187,115,.05);">
    <strong style="color:#d3bb73;">Harmonogram zostanie uzupełniony później</strong>
    <p style="margin:8px 0 0;color:rgba(229,228,226,.75);line-height:1.5;">
      Jesteś zapraszany do zespołu wydarzenia niezależnie od timeline. Po przypisaniu godzin otrzymasz osobną wiadomość z aktualnym harmonogramem.
    </p>
  </div>
`
          : '';

    const actionSectionHtml =
      mode === 'timeline_update'
        ? `
      <div style="margin-top:30px;padding:22px;border:1px solid rgba(211,187,115,.2);border-radius:10px;text-align:center;">
        <p style="margin:0 0 14px;color:#e5e4e2;line-height:1.6;">
          Harmonogram został uzupełniony. Sprawdź godziny pracy powyżej. W razie rozbieżności skontaktuj się z opiekunem wydarzenia.
        </p>
        <a href="${eventUrl}" class="link">Zobacz szczegóły wydarzenia w CRM →</a>
      </div>
    `
        : `
      <p class="text center" style="margin-top:40px;margin-bottom:20px;font-weight:500;">Potwierdź swoją obecność:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td class="mobile-full" width="50%" style="padding:5px;">
          <a href="${acceptUrl}" style="display:block;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;padding:14px 20px;text-align:center;">Akceptuję zaproszenie</a>
        </td>
        <td class="mobile-full" width="50%" style="padding:5px;">
          <a href="${rejectUrl}" style="display:block;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;padding:14px 20px;text-align:center;">Odrzucam zaproszenie</a>
        </td>
      </tr></table>
      <div style="margin-top:30px;padding-top:25px;border-top:1px solid rgba(211,187,115,.2);text-align:center;">
        <p style="font-size:14px;color:rgba(229,228,226,.6);">Możesz też zalogować się do CRM, aby zobaczyć więcej szczegółów.</p>
        <a href="${eventUrl}" class="link">Zobacz szczegóły wydarzenia w CRM →</a>
        <p style="margin-top:20px;font-size:12px;color:rgba(229,228,226,.55);">Link do odpowiedzi wygasa: <strong style="color:#d3bb73;">${expiresAt}</strong></p>
      </div>
    `;

    const emailBody = `
<!DOCTYPE html>
<html lang="pl">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zaproszenie do wydarzenia</title>
  <style>
    body,
    table,
    td,
    a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table,
    td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      outline: none;
      text-decoration: none;
      display: block;
      max-width: 100%;
      height: auto;
    }

    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background-color: ${EMAIL_BRAND.background};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .wrapper {
      width: 100%;
      background-color: ${EMAIL_BRAND.background};
      margin: 0;
      padding: 0;
    }

    .container {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
    }

    .card {
      background-color: ${EMAIL_BRAND.surface};
      border: 1px solid rgba(211, 187, 115, 0.2);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .header {
      background: linear-gradient(90deg, #d3bb73 0%, #c5ad65 100%);
      padding: 20px 40px;
      text-align: center;
    }

    .header-logo {
      padding: 30px 40px;
      text-align: center;
    }

    .header-logo img {
      margin: 0 auto;
      max-width: 100%;
      height: auto;
      width: 60%;
      object-fit: contain;
    }

    .header-title {
      margin: 0;
      color: ${EMAIL_BRAND.surface};
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
    }

    .content {
      padding: 40px;
      color: #e5e4e2;
    }

    .text {
      margin: 0 0 20px;
      font-size: 16px;
      line-height: 1.6;
      color: #e5e4e2;
    }

    .muted {
      color: rgba(229, 228, 226, 0.8);
    }

    .info-box {
      background: rgba(211, 187, 115, 0.1);
      border-left: 4px solid #d3bb73;
      padding: 25px;
      margin: 30px 0;
      border-radius: 8px;
    }

    .event-title {
      margin: 0 0 20px;
      color: #d3bb73;
      font-size: 22px;
      font-weight: 600;
      line-height: 1.4;
    }

    .label {
      color: rgba(229, 228, 226, 0.6);
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 6px;
    }

    .value {
      margin: 0 0 16px;
      font-size: 16px;
      color: #e5e4e2;
      line-height: 1.6;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .center {
      text-align: center;
    }

    .button-wrap {
      padding-top: 10px;
      padding-bottom: 10px;
    }

    .button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.2;
      padding: 16px 20px;
      border-radius: 8px;
    }

    .button-accept {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: #ffffff !important;
    }

    .button-reject {
      background: rgba(239, 68, 68, 0.9);
      color: #ffffff !important;
    }

    .link {
      color: #d3bb73 !important;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      border-bottom: 1px solid rgba(211, 187, 115, 0.4);
      padding-bottom: 2px;
      word-break: break-word;
    }

    .footer-note {
      margin-top: 30px;
      padding: 20px;
      background: rgba(211, 187, 115, 0.05);
      border-radius: 8px;
      border: 1px solid rgba(211, 187, 115, 0.1);
    }

    .footer-note-text {
      margin: 0;
      font-size: 13px;
      color: rgba(229, 228, 226, 0.5);
      text-align: center;
      line-height: 1.6;
    }

    .bottom {
      background: rgba(211, 187, 115, 0.05);
      padding: 25px 40px;
      text-align: center;
      border-top: 1px solid rgba(211, 187, 115, 0.1);
    }

    .bottom-text {
      margin: 0 0 8px;
      font-size: 14px;
      color: rgba(229, 228, 226, 0.6);
      line-height: 1.5;
    }

    .bottom-copy {
      margin: 0;
      font-size: 12px;
      color: rgba(229, 228, 226, 0.4);
      line-height: 1.5;
    }

    @media only screen and (max-width: 600px) {
      .mobile-full {
        width: 100% !important;
        display: block !important;
      }

      .content {
        padding: 24px 18px !important;
      }

      .header {
        padding: 24px 18px !important;
      }

      .bottom {
        padding: 20px 18px !important;
      }

      .header-title {
        font-size: 24px !important;
        line-height: 1.3 !important;
      }

      .text,
      .value {
        font-size: 15px !important;
      }

      .event-title {
        font-size: 20px !important;
      }

      .info-box {
        padding: 18px !important;
        margin: 24px 0 !important;
      }

      .button {
        font-size: 15px !important;
        padding: 15px 16px !important;
      }

      .footer-note {
        padding: 16px !important;
      }
    }
  </style>
${systemEmailThemeHead}
<style>
body.mavinci-email, .wrapper { background-color:#faf6f7 !important; }
.card, .content { background-color:#ffffff !important; color:#292329 !important; }
.content td, .content p, .content .text, .content .value, .content strong, .content span, .content div, .content a, .bottom-text, .bottom-copy, .footer-note-text { color:#292329 !important; }
.info-box, .footer-note, .bottom { background-color:#faf6f7 !important; }
.content .label, .content .muted { color:#65555d !important; }
.content .event-title, .content .link { color:#651b38 !important; }
.content .button { background:#351020 !important; background-image:linear-gradient(#351020,#351020) !important; color:#fff !important; }
.content .button .gmail-blend-screen, .content .button .gmail-blend-difference { color:#fff !important; }
@media (prefers-color-scheme: dark) {
  body.mavinci-email, .wrapper { background-color:#191619 !important; }
  .card, .content { background-color:#242024 !important; color:#f3edf0 !important; }
  .content td, .content p, .content .text, .content .value, .content strong, .content span, .content div, .content a, .bottom-text, .bottom-copy, .footer-note-text { color:#f3edf0 !important; }
  .info-box, .footer-note, .bottom { background-color:#302930 !important; }
  .content .label, .content .muted { color:#cdbfc6 !important; }
  .content .event-title, .content .link { color:#e3ce92 !important; }
}
</style>
</head>

<body class="mavinci-email" style="margin:0;padding:0;background-color:${EMAIL_BRAND.background};color:${EMAIL_BRAND.text};">
  <table bgcolor="${EMAIL_BRAND.background}" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="container">
          <tr>
            <td class="card" bgcolor="${EMAIL_BRAND.surface}" style="background-color:${EMAIL_BRAND.surface};color:${EMAIL_BRAND.text};">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="header-logo" bgcolor="#351020" style="background:#351020;background-image:linear-gradient(#351020,#351020);">
                    <img src="${emailLogoUrl}" alt="Mavinci CRM" width="120" style="display:block; width:120px; max-width:100%; height:auto; margin:0 auto;">
                  </td>
                </tr>
                <tr>
                  <td class="header" bgcolor="#351020" style="background:#351020;background-image:linear-gradient(#351020,#351020);">
                    <h1 class="header-title" style="color:#fff;">${gmailWhiteText(mode === 'timeline_update' ? 'Potwierdzony harmonogram' : 'Zaproszenie do wydarzenia')}</h1>
                  </td>
                </tr>

                <tr>
                  <td class="content">
                    <p class="text">
                      Cześć <strong>${employee.name} ${employee.surname}</strong>,
                    </p>

                    <p class="text muted">
                      ${mode === 'timeline_update' ? 'Przesyłamy aktualny harmonogram Twojej pracy przy wydarzeniu:' : 'Zostałeś zaproszony do zespołu wydarzenia. Poniżej szczegóły:'}
                    </p>

                    <div class="info-box" style="background-color:${EMAIL_BRAND.panel};">
                      <h2 class="event-title">${event.name}</h2>

                      <!-- DATA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            ${renderEmailIcon('calendar')}
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Data wydarzenia
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;font-weight:500;margin-bottom:12px;">
                        ${eventDateFormatted}
                      </div>

                      ${
                        locationText
                          ? `
                      <!-- LOKALIZACJA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            ${renderEmailIcon('location')}
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Lokalizacja
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;word-break:break-word;">
                        <a href="${escapeLocationHtml(googleMapsLocationUrl)}" target="_blank" rel="noopener noreferrer" style="color:${EMAIL_BRAND.text};text-decoration:underline;">
                          ${escapeLocationHtml(locationText)}
                        </a>
                      </div>
                      <div style="font-size:13px;line-height:1.8;margin-bottom:16px;color:${EMAIL_BRAND.text};">
                        Wyznacz trasę:
                        <a href="${escapeLocationHtml(googleMapsDirectionsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:4px 8px;color:${EMAIL_BRAND.gold};text-decoration:underline;">Google Maps</a>
                        <span aria-hidden="true"> · </span>
                        <a href="${escapeLocationHtml(appleMapsDirectionsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:4px 8px;color:${EMAIL_BRAND.gold};text-decoration:underline;">Apple Maps</a>
                      </div>
                      `
                          : ''
                      }

                      ${roomDescription ? `<div style="margin:12px 0 20px;font-size:14px;line-height:1.6;color:${EMAIL_BRAND.text}"><strong>Sale realizacji:</strong> ${escapeLocationHtml(roomDescription)}</div>` : ''}
                      ${
                        assignment.role
                          ? `
                      <!-- ROLA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            ${renderEmailIcon('user')}
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Twoja rola
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;">
                        ${assignment.role}
                      </div>
                      `
                          : ''
                      }

                      ${
                        assignment.responsibilities
                          ? `
                      <!-- OBOWIĄZKI -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            ${renderEmailIcon('checklist')}
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Obowiązki
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;white-space:pre-wrap;">
                        ${assignment.responsibilities}
                      </div>
                      `
                          : ''
                      }

                      ${
                        event.description
                          ? `
                      <!-- OPIS -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            ${renderEmailIcon('info')}
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Opis wydarzenia
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div
                        style="font-size:16px;color:rgba(229,228,226,0.8);margin-bottom:12px;line-height:1.6;white-space:pre-wrap;">
                        ${event.description}
                      </div>
                      `
                          : ''
                      }

                    </div>

                    ${phasesTableHtml}

                    ${actionSectionHtml}
                  </td>
                </tr>

                <tr>
                  <td class="bottom">
                    <p class="bottom-text">
                      Wiadomość wysłana z systemu <strong style="color: #d3bb73;">Mavinci CRM</strong>
                    </p>
                    <p class="bottom-copy">
                      © ${new Date().getFullYear()} Mavinci Events. Wszelkie prawa zastrzeżone.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>

</html>
    `;

    const { data: systemEmail } = await supabase
      .from('employee_email_accounts')
      .select('id')
      .eq('is_system_account', true)
      .maybeSingle();

    if (!systemEmail) {
      console.error('[send-event-invitation] System email not configured');
      throw new Error('System email account not configured');
    }

    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;

    const emailPromises = notificationEmails.map(async (emailAddress) => {
      console.log('[send-event-invitation] Sending email to:', emailAddress);

      const sendEmailResponse = await fetch(sendEmailUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.get('Authorization') || '',
        },
        body: JSON.stringify({
          to: emailAddress,
          subject:
            mode === 'timeline_update'
              ? `Uzupełniony harmonogram: ${event.name}`
              : `Zaproszenie do wydarzenia: ${event.name}`,
          body: emailBody,
          emailAccountId: systemEmail.id,
        }),
      });

      if (!sendEmailResponse.ok) {
        const errorData = await sendEmailResponse.json();
        console.error(`[send-event-invitation] Email send failed for ${emailAddress}:`, errorData);
        throw new Error(
          `Failed to send email to ${emailAddress}: ${errorData.error || 'Unknown error'}`,
        );
      }

      return emailAddress;
    });

    const sentEmails = await Promise.all(emailPromises);

    await supabase
      .from('employee_assignments')
      .update(
        mode === 'timeline_update'
          ? {
              invitation_includes_phases: true,
              timeline_update_email_sent_at: new Date().toISOString(),
            }
          : {
              invitation_email_sent: true,
              invitation_email_sent_at: new Date().toISOString(),
              invitation_includes_phases: includePhases && phaseAssignments.length > 0,
            },
      )
      .eq('id', assignmentId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Invitation email sent successfully',
        sentTo: sentEmails,
        preference: preference,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('[send-event-invitation] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
