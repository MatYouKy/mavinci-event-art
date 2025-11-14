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

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

interface DialogContextValue {
  showDialog: (config: DialogConfig) => void;
  showAlert: (
    message: string,
    title?: string,
    type?: 'info' | 'success' | 'warning' | 'error',
  ) => Promise<void>;
  showConfirm: (options: string | ConfirmOptions, title?: string) => Promise<boolean>;
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

  const showAlert = useCallback(
    (
      message: string,
      title?: string,
      type: 'info' | 'success' | 'warning' | 'error' = 'info',
    ): Promise<void> => {
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
              variant: 'primary',
            },
          ],
        });
      });
    },
    [hideDialog],
  );

  const showConfirm = useCallback(
    (options: string | ConfirmOptions, title?: string): Promise<boolean> => {
      return new Promise((resolve) => {
        setResolvePromise(() => resolve);

        const config =
          typeof options === 'string'
            ? {
                message: options,
                title: title || 'Potwierdzenie',
                confirmText: 'Potwierdź',
                cancelText: 'Anuluj',
              }
            : {
                title: options.title || 'Potwierdzenie',
                message: options.message,
                confirmText: options.confirmText || 'Potwierdź',
                cancelText: options.cancelText || 'Anuluj',
              };

        setDialog({
          title: config.title,
          message: config.message,
          type: 'confirm',
          buttons: [
            {
              label: config.cancelText,
              onClick: () => {
                hideDialog();
                resolve(false);
              },
              variant: 'secondary',
            },
            {
              label: config.confirmText,
              onClick: () => {
                hideDialog();
                resolve(true);
              },
              variant: 'danger',
            },
          ],
        });
      });
    },
    [hideDialog],
  );

  const getIcon = () => {
    switch (dialog?.type) {
      case 'success':
        return <CheckCircle className="h-12 w-12 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-12 w-12 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-12 w-12 text-yellow-500" />;
      case 'confirm':
        return <AlertTriangle className="h-12 w-12 text-yellow-500" />;
      default:
        return <Info className="h-12 w-12 text-blue-500" />;
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
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={hideDialog} />
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            <button
              onClick={hideDialog}
              className="absolute right-4 top-4 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-8">
              <div className="mb-6 flex flex-col items-center text-center">
                {getIcon()}
                <h3 className="mb-2 mt-4 text-xl font-semibold text-[#e5e4e2]">{dialog.title}</h3>
                <div className="text-sm text-[#e5e4e2]/80">
                  {typeof dialog.message === 'string' ? <p>{dialog.message}</p> : dialog.message}
                </div>
              </div>

              <div className="flex justify-center gap-3">
                {dialog.buttons?.map((button, index) => (
                  <button
                    key={index}
                    onClick={button.onClick}
                    className={`rounded-lg px-6 py-2.5 font-medium transition-colors ${getButtonClass(button.variant)}`}
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
