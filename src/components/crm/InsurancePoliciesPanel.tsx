'use client';

import { useState, useEffect } from 'react';
import { Shield, Plus, Edit, Archive, ChevronDown, ChevronUp, Calendar, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Modal from '@/components/UI/Modal';
import { Formik, Form, Field } from 'formik';
import * as Yup from 'yup';

interface InsurancePolicy {
  id: string;
  vehicle_id: string;
  type: 'oc' | 'ac' | 'nnw' | 'assistance' | 'other';
  insurance_company: string;
  policy_number: string;
  start_date: string;
  end_date: string;
  premium_amount: number;
  is_mandatory: boolean;
  blocks_usage: boolean;
  detailed_coverage: any;
  notes?: string;
  status: 'active' | 'expired';
}

interface InsurancePoliciesPanelProps {
  vehicleId: string;
}

const insuranceTypeLabels = {
  oc: 'OC',
  ac: 'AC',
  nnw: 'NNW',
  assistance: 'Assistance',
  other: 'Inne'
};

const validationSchema = Yup.object({
  type: Yup.string().required('Typ jest wymagany'),
  insurance_company: Yup.string().required('Firma jest wymagana'),
  policy_number: Yup.string().required('Numer polisy jest wymagany'),
  start_date: Yup.date().required('Data rozpoczęcia jest wymagana'),
  end_date: Yup.date()
    .required('Data zakończenia jest wymagana')
    .min(Yup.ref('start_date'), 'Data zakończenia musi być późniejsza'),
  premium_amount: Yup.number()
    .required('Kwota składki jest wymagana')
    .min(0, 'Kwota musi być dodatnia'),
});

export default function InsurancePoliciesPanel({ vehicleId }: InsurancePoliciesPanelProps) {
  const { showSnackbar } = useSnackbar();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<InsurancePolicy | null>(null);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicies();
  }, [vehicleId]);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('insurance_policies')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('end_date', { ascending: false });

      if (error) throw error;

      const policiesWithStatus = (data || []).map(policy => ({
        ...policy,
        status: new Date(policy.end_date) >= new Date() ? 'active' : 'expired'
      }));

      setPolicies(policiesWithStatus);
    } catch (error: any) {
      console.error('Error fetching policies:', error);
      showSnackbar('Błąd podczas ładowania ubezpieczeń', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any, { setSubmitting }: any) => {
    try {
      const policyData = {
        ...values,
        vehicle_id: vehicleId,
        is_mandatory: values.type === 'oc',
        blocks_usage: values.type === 'oc',
        detailed_coverage: values.type === 'ac' ? values.detailed_coverage || {} : {}
      };

      if (editingPolicy) {
        const { error } = await supabase
          .from('insurance_policies')
          .update(policyData)
          .eq('id', editingPolicy.id);

        if (error) throw error;
        showSnackbar('Ubezpieczenie zaktualizowane', 'success');
      } else {
        const { error } = await supabase
          .from('insurance_policies')
          .insert([policyData]);

        if (error) throw error;
        showSnackbar('Ubezpieczenie dodane', 'success');
      }

      setShowModal(false);
      setEditingPolicy(null);
      fetchPolicies();
    } catch (error: any) {
      console.error('Error saving policy:', error);
      showSnackbar(error.message || 'Błąd podczas zapisywania', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (policyId: string) => {
    if (!confirm('Czy na pewno chcesz zarchiwizować to ubezpieczenie?')) return;

    try {
      const { error } = await supabase
        .from('insurance_policies')
        .delete()
        .eq('id', policyId);

      if (error) throw error;

      showSnackbar('Ubezpieczenie zarchiwizowane', 'success');
      fetchPolicies();
    } catch (error: any) {
      console.error('Error archiving policy:', error);
      showSnackbar('Błąd podczas archiwizacji', 'error');
    }
  };

  const getStatusBadge = (status: string, is_mandatory: boolean) => {
    if (status === 'expired') {
      return <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">Wygasło</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">Aktywne</span>
        {is_mandatory && <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] text-xs rounded">🔒 Obowiązkowe</span>}
      </div>
    );
  };

  const activePolicies = policies.filter(p => p.status === 'active');
  const expiredPolicies = policies.filter(p => p.status === 'expired');

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#d3bb73]" />
          <div>
            <h3 className="text-lg font-semibold text-[#e5e4e2]">Ubezpieczenia</h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {activePolicies.length} aktywne
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setEditingPolicy(null);
            setShowModal(true);
          }}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj ubezpieczenie
        </button>
      </div>

      {/* Active Policies */}
      {activePolicies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[#e5e4e2]/80">Aktywne ubezpieczenia</h4>
          {activePolicies.map((policy) => (
            <div
              key={policy.id}
              className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded font-medium">
                      {insuranceTypeLabels[policy.type]}
                    </span>
                    {getStatusBadge(policy.status, policy.is_mandatory)}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[#e5e4e2] font-medium">{policy.insurance_company}</p>
                    <p className="text-sm text-[#e5e4e2]/60">Polisa: {policy.policy_number}</p>
                    <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(policy.start_date).toLocaleDateString('pl-PL')} - {new Date(policy.end_date).toLocaleDateString('pl-PL')}
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {policy.premium_amount.toFixed(2)} PLN
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingPolicy(policy);
                      setShowModal(true);
                    }}
                    className="p-2 hover:bg-[#d3bb73]/10 rounded transition-colors"
                    title="Edytuj"
                  >
                    <Edit className="w-4 h-4 text-[#e5e4e2]/60" />
                  </button>
                  {policy.type === 'ac' && (
                    <button
                      onClick={() => setExpandedPolicyId(expandedPolicyId === policy.id ? null : policy.id)}
                      className="p-2 hover:bg-[#d3bb73]/10 rounded transition-colors"
                      title="Zakres ochrony"
                    >
                      {expandedPolicyId === policy.id ? (
                        <ChevronUp className="w-4 h-4 text-[#e5e4e2]/60" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[#e5e4e2]/60" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleArchive(policy.id)}
                    className="p-2 hover:bg-red-500/10 rounded transition-colors"
                    title="Archiwizuj"
                  >
                    <Archive className="w-4 h-4 text-[#e5e4e2]/60" />
                  </button>
                </div>
              </div>

              {/* Expanded Coverage Details for AC */}
              {policy.type === 'ac' && expandedPolicyId === policy.id && policy.detailed_coverage && (
                <div className="mt-4 pt-4 border-t border-[#d3bb73]/10">
                  <h5 className="text-sm font-medium text-[#e5e4e2] mb-2">Zakres ochrony AC:</h5>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {policy.detailed_coverage.theft && <span className="text-[#e5e4e2]/60">✓ Kradzież</span>}
                    {policy.detailed_coverage.fire && <span className="text-[#e5e4e2]/60">✓ Pożar</span>}
                    {policy.detailed_coverage.vandalism && <span className="text-[#e5e4e2]/60">✓ Wandalizm</span>}
                    {policy.detailed_coverage.glass && <span className="text-[#e5e4e2]/60">✓ Szyby</span>}
                    {policy.detailed_coverage.natural_disasters && <span className="text-[#e5e4e2]/60">✓ Klęski żywiołowe</span>}
                    {policy.detailed_coverage.collision?.own_fault && <span className="text-[#e5e4e2]/60">✓ Kolizja (własna wina)</span>}
                    {policy.detailed_coverage.collision?.others_fault && <span className="text-[#e5e4e2]/60">✓ Kolizja (cudza wina)</span>}
                    {policy.detailed_coverage.assistance?.towing && <span className="text-[#e5e4e2]/60">✓ Holowanie</span>}
                    {policy.detailed_coverage.assistance?.replacement_vehicle && <span className="text-[#e5e4e2]/60">✓ Auto zastępcze</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expired Policies */}
      {expiredPolicies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[#e5e4e2]/80">Wygasłe ubezpieczenia</h4>
          {expiredPolicies.map((policy) => (
            <div
              key={policy.id}
              className="bg-[#1c1f33]/50 rounded-lg border border-[#e5e4e2]/10 p-4 opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-medium text-[#e5e4e2]">
                      {insuranceTypeLabels[policy.type]} - {policy.insurance_company}
                    </span>
                    {getStatusBadge(policy.status, policy.is_mandatory)}
                  </div>
                  <p className="text-xs text-[#e5e4e2]/60">
                    Wygasło: {new Date(policy.end_date).toLocaleDateString('pl-PL')}
                  </p>
                </div>
                <button
                  onClick={() => handleArchive(policy.id)}
                  className="p-2 hover:bg-red-500/10 rounded transition-colors"
                  title="Usuń"
                >
                  <Archive className="w-4 h-4 text-[#e5e4e2]/40" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {policies.length === 0 && (
        <div className="text-center py-8 text-[#e5e4e2]/60">
          <Shield className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>Brak ubezpieczeń</p>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setEditingPolicy(null);
          }}
          title={editingPolicy ? 'Edytuj ubezpieczenie' : 'Dodaj ubezpieczenie'}
        >
          <Formik
            initialValues={{
              type: editingPolicy?.type || 'oc',
              insurance_company: editingPolicy?.insurance_company || '',
              policy_number: editingPolicy?.policy_number || '',
              start_date: editingPolicy?.start_date || new Date().toISOString().split('T')[0],
              end_date: editingPolicy?.end_date || '',
              premium_amount: editingPolicy?.premium_amount || 0,
              notes: editingPolicy?.notes || '',
              detailed_coverage: editingPolicy?.detailed_coverage || {
                theft: false,
                fire: false,
                vandalism: false,
                glass: false,
                natural_disasters: false,
                collision: {
                  own_fault: false,
                  others_fault: false
                },
                assistance: {
                  towing: false,
                  replacement_vehicle: false
                }
              }
            }}
            validationSchema={validationSchema}
            onSubmit={handleSubmit}
          >
            {({ errors, touched, values, setFieldValue, isSubmitting }) => (
              <Form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                    Typ ubezpieczenia *
                  </label>
                  <Field
                    as="select"
                    name="type"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="oc">OC (Obowiązkowe)</option>
                    <option value="ac">AC (Autocasco)</option>
                    <option value="nnw">NNW</option>
                    <option value="assistance">Assistance</option>
                    <option value="other">Inne</option>
                  </Field>
                  {errors.type && touched.type && (
                    <p className="text-red-400 text-xs mt-1">{errors.type}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                    Firma ubezpieczeniowa *
                  </label>
                  <Field
                    name="insurance_company"
                    type="text"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  {errors.insurance_company && touched.insurance_company && (
                    <p className="text-red-400 text-xs mt-1">{errors.insurance_company}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                    Numer polisy *
                  </label>
                  <Field
                    name="policy_number"
                    type="text"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  {errors.policy_number && touched.policy_number && (
                    <p className="text-red-400 text-xs mt-1">{errors.policy_number}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                      Data rozpoczęcia *
                    </label>
                    <Field
                      name="start_date"
                      type="date"
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    />
                    {errors.start_date && touched.start_date && (
                      <p className="text-red-400 text-xs mt-1">{errors.start_date}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                      Data zakończenia *
                    </label>
                    <Field
                      name="end_date"
                      type="date"
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    />
                    {errors.end_date && touched.end_date && (
                      <p className="text-red-400 text-xs mt-1">{errors.end_date}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                    Składka (PLN) *
                  </label>
                  <Field
                    name="premium_amount"
                    type="number"
                    step="0.01"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  {errors.premium_amount && touched.premium_amount && (
                    <p className="text-red-400 text-xs mt-1">{errors.premium_amount}</p>
                  )}
                </div>

                {/* AC Coverage Details */}
                {values.type === 'ac' && (
                  <div className="border border-[#d3bb73]/20 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-[#e5e4e2] mb-3">Zakres ochrony AC:</h4>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.theft || false}
                          onChange={(e) => setFieldValue('detailed_coverage.theft', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Kradzież</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.fire || false}
                          onChange={(e) => setFieldValue('detailed_coverage.fire', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Pożar</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.vandalism || false}
                          onChange={(e) => setFieldValue('detailed_coverage.vandalism', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Wandalizm</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.glass || false}
                          onChange={(e) => setFieldValue('detailed_coverage.glass', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Szyby</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.natural_disasters || false}
                          onChange={(e) => setFieldValue('detailed_coverage.natural_disasters', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Klęski żywiołowe</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.collision?.own_fault || false}
                          onChange={(e) => setFieldValue('detailed_coverage.collision.own_fault', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Kolizja - własna wina</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.collision?.others_fault || false}
                          onChange={(e) => setFieldValue('detailed_coverage.collision.others_fault', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Kolizja - cudza wina</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.assistance?.towing || false}
                          onChange={(e) => setFieldValue('detailed_coverage.assistance.towing', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Holowanie</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={values.detailed_coverage?.assistance?.replacement_vehicle || false}
                          onChange={(e) => setFieldValue('detailed_coverage.assistance.replacement_vehicle', e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm text-[#e5e4e2]">Auto zastępcze</span>
                      </label>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-1">
                    Notatki
                  </label>
                  <Field
                    as="textarea"
                    name="notes"
                    rows={3}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setEditingPolicy(null);
                    }}
                    className="px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                  >
                    Anuluj
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Zapisywanie...' : editingPolicy ? 'Zapisz' : 'Dodaj'}
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        </Modal>
      )}
    </div>
  );
}
