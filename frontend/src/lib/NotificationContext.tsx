import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'primary';
}

interface NotificationContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface ProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<ProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const handleConfirm = (value: boolean) => {
    if (confirmState) {
      confirmState.resolve(value);
      setConfirmState(null);
    }
  };

  return (
    <NotificationContext.Provider value={{ showToast, confirm }}>
      {children}
      
      {/* Toasts Container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg border text-sm font-medium animate-in fade-in slide-in-from-right-4 duration-300 flex items-center gap-3 min-w-[200px] max-w-[350px] ${
              toast.type === 'success' ? 'bg-white border-green-100 text-green-700' :
              toast.type === 'error' ? 'bg-red-50 border-red-100 text-red-700' :
              'bg-white border-slate-100 text-slate-700'
            }`}
          >
            {toast.type === 'success' && (
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === 'error' && (
              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {toast.message}
          </div>
        ))}
      </div>

      {/* Confirmation Modal */}
      {confirmState && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" 
            onClick={() => handleConfirm(false)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4 ${
                confirmState.options.type === 'danger' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'
              }`}>
                {confirmState.options.type === 'danger' ? (
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">{confirmState.options.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{confirmState.options.message}</p>
            </div>
            <div className="flex border-t border-slate-50">
              <button
                onClick={() => handleConfirm(false)}
                className="flex-1 px-4 py-4 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors border-r border-slate-50"
              >
                {confirmState.options.cancelText || 'Cancelar'}
              </button>
              <button
                onClick={() => handleConfirm(true)}
                className={`flex-1 px-4 py-4 text-sm font-bold transition-colors hover:opacity-90 ${
                  confirmState.options.type === 'danger' ? 'text-red-500 bg-red-50/30' : 'text-[#1a2e4a]'
                }`}
              >
                {confirmState.options.confirmText || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};
