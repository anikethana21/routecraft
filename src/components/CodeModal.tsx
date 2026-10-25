import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { CODE_LANGUAGES, generateCode, type CodeLanguage } from '../lib/codegen';
import { Modal } from './Modal';

export const CodeModal: React.FC = () => {
  const { codeModal, closeCode, notify } = useApp();
  const [language, setLanguage] = useState<CodeLanguage>('curl');
  const [copied, setCopied] = useState(false);

  const code = useMemo(
    () => (codeModal ? generateCode(language, codeModal.request) : ''),
    [codeModal, language],
  );

  if (!codeModal) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      notify('Code copied to the clipboard.');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('Could not access the clipboard.', 'error');
    }
  };

  return (
    <Modal
      title="Code snippet"
      subtitle={codeModal.title || `${codeModal.request.method} ${codeModal.request.url}`}
      onClose={closeCode}
      width={820}
      className="code-modal"
      footer={
        <>
          <span className="code-foot-hint">Ready to paste into your project.</span>
          <div className="op-action-spacer" />
          <button type="button" className="btn btn-primary" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      <div className="code-langs" role="tablist" aria-label="Language">
        {CODE_LANGUAGES.map((item) => (
          <button
            type="button"
            key={item.id}
            role="tab"
            aria-selected={language === item.id}
            className={language === item.id ? 'is-active' : ''}
            onClick={() => setLanguage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <pre className="code-block code-output">
        <code>{code}</code>
      </pre>
    </Modal>
  );
};
