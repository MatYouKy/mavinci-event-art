import React from 'react';
import { Modal } from '../Modal';
import { FormInput } from '../../formik/FormInput';

interface FormikFieldModalProps {
  title: string;
  open: boolean;
  fieldName: string;
  onClose: () => void;
  onSave: () => void;
  values: any;
  isMobile: boolean;
  label: string;
}

export const FormikFieldModal: React.FC<FormikFieldModalProps> = ({
  title,
  open,
  fieldName,
  onClose,
  onSave,
  values,
  isMobile,
  label,
}) => {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <FormInput name={fieldName} label={label} />
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#e5e4e2]/30 bg-transparent px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10"
          >
            Anuluj
          </button>
          <button
            onClick={onSave}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/80"
          >
            Zapisz
          </button>
        </div>
      </div>
    </Modal>
  );
};
