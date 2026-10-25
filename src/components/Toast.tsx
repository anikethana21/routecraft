import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { appPortalTarget } from '../lib/portal';

export const Toast: React.FC = () => {
  const { toast, dismissToast } = useApp();
  if (!toast) return null;
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertTriangle : Info;
  return createPortal(
    <div className={`toast toast-${toast.tone}`} role="status">
      <Icon size={16} />
      <span>{toast.message}</span>
      <button type="button" onClick={dismissToast} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>,
    appPortalTarget(),
  );
};
