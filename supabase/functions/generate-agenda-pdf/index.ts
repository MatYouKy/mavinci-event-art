import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateAgendaPdfRequest {
  agendaId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { agendaId }: GenerateAgendaPdfRequest = await req.json();

    if (!agendaId) {
      throw new Error("agendaId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: agenda, error: agendaError } = await supabase
      .from("event_agendas")
      .select(`
        *,
        items:event_agenda_items(*),
        notes:event_agenda_notes(*)
      `)
      .eq("id", agendaId)
      .maybeSingle();

    if (agendaError || !agenda) {
      throw new Error("Agenda not found");
    }

    const { data: items, error: itemsError } = await supabase
      .from("event_agenda_items")
      .select("*")
      .eq("agenda_id", agendaId)
      .order("order_index");

    if (itemsError) {
      throw new Error("Failed to fetch agenda items");
    }

    const { data: notes, error: notesError } = await supabase
      .from("event_agenda_notes")
      .select("*")
      .eq("agenda_id", agendaId)
      .order("order_index");

    if (notesError) {
      throw new Error("Failed to fetch agenda notes");
    }

    const buildNoteTree = (flatNotes: any[]) => {
      const noteMap = new Map();
      const rootNotes: any[] = [];

      flatNotes.forEach((note) => {
        noteMap.set(note.id, { ...note, children: [] });
      });

      flatNotes.forEach((note) => {
        const noteWithChildren = noteMap.get(note.id);
        if (note.parent_id) {
          const parent = noteMap.get(note.parent_id);
          if (parent) {
            parent.children = parent.children || [];
            parent.children.push(noteWithChildren);
          }
        } else {
          rootNotes.push(noteWithChildren);
        }
      });

      return rootNotes;
    };

    const noteTree = buildNoteTree(notes || []);

    const generateNotesHtml = (notes: any[], level: number = 0): string => {
      return notes
        .map((note) => {
          const indent = level * 20;
          const bullet = level === 0 ? '•' : level === 1 ? '◦' : '-';
          let html = `<div style="margin-left: ${indent}px; margin-bottom: 8px;">
            <span style="color: #d3bb73; margin-right: 8px;">${bullet}</span>
            <span>${note.content}</span>
          </div>`;

          if (note.children && note.children.length > 0) {
            html += generateNotesHtml(note.children, level + 1);
          }

          return html;
        })
        .join('');
    };

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 40px;
            background: #0f1119;
            color: #e5e4e2;
          }
          .header {
            border-bottom: 2px solid #d3bb73;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #d3bb73;
            margin: 0;
            font-size: 28px;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 30px;
          }
          .info-item {
            background: #1c1f33;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid rgba(211, 187, 115, 0.2);
          }
          .info-label {
            color: rgba(229, 228, 226, 0.6);
            font-size: 12px;
            margin-bottom: 5px;
          }
          .info-value {
            color: #e5e4e2;
            font-size: 16px;
          }
          .section {
            margin-bottom: 30px;
          }
          .section-title {
            color: #d3bb73;
            font-size: 20px;
            margin-bottom: 15px;
            border-bottom: 1px solid rgba(211, 187, 115, 0.2);
            padding-bottom: 10px;
          }
          .agenda-item {
            background: #1c1f33;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid rgba(211, 187, 115, 0.2);
            margin-bottom: 15px;
          }
          .agenda-time {
            color: #d3bb73;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .agenda-title {
            color: #e5e4e2;
            font-size: 16px;
            margin-bottom: 5px;
          }
          .agenda-description {
            color: rgba(229, 228, 226, 0.7);
            font-size: 14px;
          }
          @media print {
            body {
              background: white;
              color: black;
            }
            .info-item, .agenda-item {
              background: white;
              border: 1px solid #ccc;
            }
            .header h1, .section-title, .agenda-time {
              color: #333;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Agenda Wydarzenia</h1>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Nazwa wydarzenia</div>
            <div class="info-value">${agenda.event_name || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Data</div>
            <div class="info-value">${agenda.event_date || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Rozpoczęcie</div>
            <div class="info-value">${agenda.start_time || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Zakończenie</div>
            <div class="info-value">${agenda.end_time || '-'}</div>
          </div>
          <div class="info-item" style="grid-column: span 2;">
            <div class="info-label">Kontakt do klienta</div>
            <div class="info-value">${agenda.client_contact || '-'}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Harmonogram</div>
          ${(items || [])
            .map(
              (item: any) => `
            <div class="agenda-item">
              <div class="agenda-time">${item.time}</div>
              <div class="agenda-title">${item.title}</div>
              ${item.description ? `<div class="agenda-description">${item.description}</div>` : ''}
            </div>
          `
            )
            .join('')}
          ${(items || []).length === 0 ? '<p style="color: rgba(229, 228, 226, 0.6);">Brak etapów w harmonogramie</p>' : ''}
        </div>

        <div class="section">
          <div class="section-title">Uwagi</div>
          ${noteTree.length > 0 ? generateNotesHtml(noteTree) : '<p style="color: rgba(229, 228, 226, 0.6);">Brak uwag</p>'}
        </div>
      </body>
      </html>
    `;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Agenda data ready for PDF generation",
        agenda: {
          ...agenda,
          items: items || [],
          notes: noteTree,
        },
        htmlContent,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
