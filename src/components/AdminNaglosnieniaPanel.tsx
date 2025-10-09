'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Plus, Trash2, Edit, Save, X } from 'lucide-react';

interface Feature {
  id: string;
  title: string;
  icon: string;
  order_index: number;
  is_active: boolean;
}

interface Application {
  id: string;
  title: string;
  description: string;
  image_url: string;
  order_index: number;
  is_active: boolean;
}

export function AdminNaglosnieniaPanel() {
  const { showSnackbar } = useSnackbar();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFeature, setEditingFeature] = useState<string | null>(null);
  const [editingApplication, setEditingApplication] = useState<string | null>(null);
  const [newFeature, setNewFeature] = useState({ title: '', icon: 'CheckCircle2' });
  const [newApplication, setNewApplication] = useState({ title: '', description: '', image_url: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [featuresRes, applicationsRes] = await Promise.all([
        supabase.from('naglosnienie_features').select('*').order('order_index'),
        supabase.from('naglosnienie_applications').select('*').order('order_index'),
      ]);

      if (featuresRes.data) setFeatures(featuresRes.data);
      if (applicationsRes.data) setApplications(applicationsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      showSnackbar('Błąd wczytywania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addFeature = async () => {
    if (!newFeature.title.trim()) {
      showSnackbar('Tytuł nie może być pusty', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('naglosnienie_features').insert({
        title: newFeature.title,
        icon: newFeature.icon,
        order_index: features.length + 1,
      });

      if (error) throw error;
      await loadData();
      setNewFeature({ title: '', icon: 'CheckCircle2' });
      showSnackbar('Cecha dodana pomyślnie', 'success');
    } catch (error) {
      console.error('Error adding feature:', error);
      showSnackbar('Błąd dodawania cechy', 'error');
    }
  };

  const deleteFeature = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę cechę?')) return;

    try {
      const { error } = await supabase.from('naglosnienie_features').delete().eq('id', id);
      if (error) throw error;
      await loadData();
      showSnackbar('Cecha usunięta pomyślnie', 'success');
    } catch (error) {
      console.error('Error deleting feature:', error);
      showSnackbar('Błąd usuwania cechy', 'error');
    }
  };

  const updateFeature = async (id: string, updates: Partial<Feature>) => {
    try {
      const { error } = await supabase.from('naglosnienie_features').update(updates).eq('id', id);
      if (error) throw error;
      await loadData();
      setEditingFeature(null);
      showSnackbar('Cecha zaktualizowana pomyślnie', 'success');
    } catch (error) {
      console.error('Error updating feature:', error);
      showSnackbar('Błąd aktualizacji cechy', 'error');
    }
  };

  const addApplication = async () => {
    if (!newApplication.title.trim() || !newApplication.description.trim() || !newApplication.image_url.trim()) {
      showSnackbar('Wszystkie pola muszą być wypełnione', 'error');
      return;
    }

    try {
      const { error } = await supabase.from('naglosnienie_applications').insert({
        title: newApplication.title,
        description: newApplication.description,
        image_url: newApplication.image_url,
        order_index: applications.length + 1,
      });

      if (error) throw error;
      await loadData();
      setNewApplication({ title: '', description: '', image_url: '' });
      showSnackbar('Zastosowanie dodane pomyślnie', 'success');
    } catch (error) {
      console.error('Error adding application:', error);
      showSnackbar('Błąd dodawania zastosowania', 'error');
    }
  };

  const deleteApplication = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zastosowanie?')) return;

    try {
      const { error } = await supabase.from('naglosnienie_applications').delete().eq('id', id);
      if (error) throw error;
      await loadData();
      showSnackbar('Zastosowanie usunięte pomyślnie', 'success');
    } catch (error) {
      console.error('Error deleting application:', error);
      showSnackbar('Błąd usuwania zastosowania', 'error');
    }
  };

  const updateApplication = async (id: string, updates: Partial<Application>) => {
    try {
      const { error } = await supabase.from('naglosnienie_applications').update(updates).eq('id', id);
      if (error) throw error;
      await loadData();
      setEditingApplication(null);
      showSnackbar('Zastosowanie zaktualizowane pomyślnie', 'success');
    } catch (error) {
      console.error('Error updating application:', error);
      showSnackbar('Błąd aktualizacji zastosowania', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-16 h-16 border-4 border-[#d3bb73] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-[#1c1f33] rounded-lg p-6">
        <h2 className="text-2xl font-light text-[#e5e4e2] mb-6">Cechy Oferty</h2>

        <div className="mb-6 p-4 bg-[#0f1119] rounded-lg">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Dodaj nową cechę</h3>
          <div className="flex gap-4">
            <input
              type="text"
              value={newFeature.title}
              onChange={(e) => setNewFeature({ ...newFeature, title: e.target.value })}
              placeholder="Tytuł cechy"
              className="flex-1 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
            <input
              type="text"
              value={newFeature.icon}
              onChange={(e) => setNewFeature({ ...newFeature, icon: e.target.value })}
              placeholder="Nazwa ikony"
              className="w-48 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
            <button
              onClick={addFeature}
              className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Dodaj
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {features.map((feature) => (
            <div key={feature.id} className="flex items-center gap-4 p-4 bg-[#0f1119] rounded-lg">
              {editingFeature === feature.id ? (
                <>
                  <input
                    type="text"
                    defaultValue={feature.title}
                    onBlur={(e) => updateFeature(feature.id, { title: e.target.value })}
                    className="flex-1 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                  <button
                    onClick={() => setEditingFeature(null)}
                    className="p-2 text-[#e5e4e2] hover:text-[#d3bb73] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[#e5e4e2]">{feature.title}</span>
                  <span className="text-[#e5e4e2]/60 text-sm">{feature.icon}</span>
                  <button
                    onClick={() => setEditingFeature(feature.id)}
                    className="p-2 text-[#e5e4e2] hover:text-[#d3bb73] transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteFeature(feature.id)}
                    className="p-2 text-[#e5e4e2] hover:text-[#800020] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#1c1f33] rounded-lg p-6">
        <h2 className="text-2xl font-light text-[#e5e4e2] mb-6">Zastosowania</h2>

        <div className="mb-6 p-4 bg-[#0f1119] rounded-lg">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">Dodaj nowe zastosowanie</h3>
          <div className="space-y-4">
            <input
              type="text"
              value={newApplication.title}
              onChange={(e) => setNewApplication({ ...newApplication, title: e.target.value })}
              placeholder="Tytuł zastosowania"
              className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
            <textarea
              value={newApplication.description}
              onChange={(e) => setNewApplication({ ...newApplication, description: e.target.value })}
              placeholder="Opis zastosowania"
              rows={2}
              className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-none"
            />
            <div className="flex gap-4">
              <input
                type="text"
                value={newApplication.image_url}
                onChange={(e) => setNewApplication({ ...newApplication, image_url: e.target.value })}
                placeholder="URL obrazu"
                className="flex-1 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
              />
              <button
                onClick={addApplication}
                className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Dodaj
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {applications.map((app) => (
            <div key={app.id} className="p-4 bg-[#0f1119] rounded-lg">
              {editingApplication === app.id ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    defaultValue={app.title}
                    onBlur={(e) => updateApplication(app.id, { title: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                  <textarea
                    defaultValue={app.description}
                    onBlur={(e) => updateApplication(app.id, { description: e.target.value })}
                    rows={2}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-none"
                  />
                  <input
                    type="text"
                    defaultValue={app.image_url}
                    onBlur={(e) => updateApplication(app.id, { image_url: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                  <button
                    onClick={() => setEditingApplication(null)}
                    className="px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                  >
                    Zamknij edycję
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <h4 className="text-[#e5e4e2] font-medium mb-2">{app.title}</h4>
                    <p className="text-[#e5e4e2]/70 text-sm mb-2">{app.description}</p>
                    <p className="text-[#e5e4e2]/50 text-xs truncate">{app.image_url}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingApplication(app.id)}
                      className="p-2 text-[#e5e4e2] hover:text-[#d3bb73] transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteApplication(app.id)}
                      className="p-2 text-[#e5e4e2] hover:text-[#800020] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
