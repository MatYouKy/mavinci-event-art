'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface DialogButton {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'secondary';
}

interface DialogConfig {
  title: string;
  message: string | ReactNode;
  type?: 'info' | 'success' | 'warning' | 'error' | 'confirm';
  buttons?: DialogButton[];
  onClose?: () => void;
}

interface DialogContextValue {
  showDialog: (config: DialogConfig) => void;
  showAlert: (message: string, title?: string, type?: 'info' | 'success' | 'warning' | 'error') => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  hideDialog: () => void;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogConfig | null>(null);
  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

  const showDialog = useCallback((config: DialogConfig) => {
    setDialog(config);
  }, []);

  const hideDialog = useCallback(() => {
    setDialog(null);
    if (resolvePromise) {
      resolvePromise(false);
      setResolvePromise(null);
    }
  }, [resolvePromise]);

  const showAlert = useCallback((message: string, title?: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> => {
    return new Promise((resolve) => {
      setDialog({
        title: title || 'Informacja',
        message,
        type,
        buttons: [
          {
            label: 'OK',
            onClick: () => {
              hideDialog();
              resolve();
            },
            variant: 'primary'
          }
        ]
      });
    });
  }, [hideDialog]);

  const showConfirm = useCallback((message: string, title?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setResolvePromise(() => resolve);
      setDialog({
        title: title || 'Potwierdzenie',
        message,
        type: 'confirm',
        buttons: [
          {
            label: 'Anuluj',
            onClick: () => {
              hideDialog();
              resolve(false);
            },
            variant: 'secondary'
          },
          {
            label: 'Potwierdź',
            onClick: () => {
              hideDialog();
              resolve(true);
            },
            variant: 'danger'
          }
        ]
      });
    });
  }, [hideDialog]);

  const getIcon = () => {
    switch (dialog?.type) {
      case 'success':
        return <CheckCircle className="w-12 h-12 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-12 h-12 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-12 h-12 text-yellow-500" />;
      case 'confirm':
        return <AlertTriangle className="w-12 h-12 text-yellow-500" />;
      default:
        return <Info className="w-12 h-12 text-blue-500" />;
    }
  };

  const getButtonClass = (variant?: 'primary' | 'danger' | 'secondary') => {
    switch (variant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 text-white';
      case 'secondary':
        return 'bg-gray-600 hover:bg-gray-700 text-white';
      default:
        return 'bg-[#d3bb73] hover:bg-[#c4ac64] text-[#1c1f33]';
    }
  };

  return (
    <DialogContext.Provider value={{ showDialog, showAlert, showConfirm, hideDialog }}>
      {children}

      {dialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={hideDialog}
          />
          <div className="relative bg-[#1c1f33] rounded-2xl shadow-2xl max-w-md w-full mx-4 border border-[#d3bb73]/20">
            <button
              onClick={hideDialog}
              className="absolute top-4 right-4 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-8">
              <div className="flex flex-col items-center text-center mb-6">
                {getIcon()}
                <h3 className="text-xl font-semibold text-[#e5e4e2] mt-4 mb-2">
                  {dialog.title}
                </h3>
                <div className="text-[#e5e4e2]/80 text-sm">
                  {typeof dialog.message === 'string' ? (
                    <p>{dialog.message}</p>
                  ) : (
                    dialog.message
                  )}
                </div>
              </div>

              <div className="flex gap-3 justify-center">
                {dialog.buttons?.map((button, index) => (
                  <button
                    key={index}
                    onClick={button.onClick}
                    className={`px-6 py-2.5 rounded-lg font-medium transition-colors ${getButtonClass(button.variant)}`}
                  >
                    {button.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}
