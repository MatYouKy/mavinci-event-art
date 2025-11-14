'use client';

import { useState, useEffect } from 'react';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Save, X, Edit } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ContentData {
  id: string;
  section: string;
  title: string;
  content: string;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EditableContentProps {
  section: string;
  tableName: string;
  defaultTitle?: string;
  defaultContent?: string;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  titleTag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span' | 'div';
  contentTag?: 'p' | 'span' | 'div';
  ariaLabel?: string;
}

export function EditableContent({
  section,
  tableName,
  defaultTitle = '',
  defaultContent = '',
  className = '',
  titleClassName = '',
  contentClassName = '',
  titleTag = 'h3',
  contentTag = 'p',
  ariaLabel,
}: EditableContentProps) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [contentData, setContentData] = useState<ContentData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editState, setEditState] = useState({
    title: defaultTitle,
    content: defaultContent,
  });

  useEffect(() => {
    loadContent();
  }, [section, tableName]);

  const loadContent = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('section', section)
        .eq('is_active', true)
        .maybeSingle();

      if (!error && data) {
        setContentData(data);
        setEditState({
          title: data.title,
          content: data.content,
        });
      } else {
        setEditState({
          title: defaultTitle,
          content: defaultContent,
        });
      }
    } catch (err) {
      console.error('Error loading content:', err);
      setEditState({
        title: defaultTitle,
        content: defaultContent,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from(tableName)
        .select('id')
        .eq('section', section)
        .maybeSingle();

      if (!existing) {
        const { error } = await supabase.from(tableName).insert({
          section: section,
          title: editState.title,
          content: editState.content,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({
            title: editState.title,
            content: editState.content,
          })
          .eq('section', section);
        if (error) throw error;
      }

      await loadContent();
      setIsEditing(false);
      showSnackbar('Treść zapisana pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving content:', error);
      showSnackbar('Błąd podczas zapisywania treści', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (contentData) {
      setEditState({
        title: contentData.title,
        content: contentData.content,
      });
    } else {
      setEditState({
        title: defaultTitle,
        content: defaultContent,
      });
    }
  };

  const displayTitle = contentData?.title || defaultTitle;
  const displayContent = contentData?.content || defaultContent;

  const TitleTag = titleTag;
  const ContentTag = contentTag;

  if (loading) {
    return (
      <div className={className} aria-busy="true" aria-label="Ładowanie treści">
        <div className="animate-pulse">
          <div className="mb-4 h-8 w-1/3 rounded bg-[#1c1f33]/50"></div>
          <div className="mb-2 h-4 w-full rounded bg-[#1c1f33]/50"></div>
          <div className="h-4 w-5/6 rounded bg-[#1c1f33]/50"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} aria-label={ariaLabel || section} role="region">
      {!isEditing ? (
        <>
          {displayTitle && <TitleTag className={titleClassName}>{displayTitle}</TitleTag>}
          {displayContent && <ContentTag className={contentClassName}>{displayContent}</ContentTag>}

          {isEditMode && (
            <button
              onClick={() => setIsEditing(true)}
              className="absolute right-0 top-0 rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              aria-label={`Edytuj ${section}`}
            >
              <Edit className="h-4 w-4" />
            </button>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Tytuł</label>
            <input
              type="text"
              value={editState.title}
              onChange={(e) => setEditState((s) => ({ ...s, title: e.target.value }))}
              className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Tytuł sekcji"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Treść</label>
            <textarea
              value={editState.content}
              onChange={(e) => setEditState((s) => ({ ...s, content: e.target.value }))}
              rows={4}
              className="w-full resize-none rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Treść sekcji"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1c1f33] border-t-transparent" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Zapisz
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#800020]/20 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
