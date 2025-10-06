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
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-transparent border border-[#e5e4e2]/30 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/10 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={onSave}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/80 transition-colors"
          >
            Zapisz
          </button>
        </div>
      </div>
    </Modal>
  );
};
