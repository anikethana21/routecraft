import React, { useEffect } from 'react';
import { useApp } from './state/AppContext';
import { TopBar } from './components/TopBar';
import { Landing } from './components/Landing';
import { DocsView } from './components/DocsView';
import { Composer } from './components/Composer';
import { AuthModal } from './components/AuthModal';
import { CodeModal } from './components/CodeModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { Toast } from './components/Toast';

const App: React.FC = () => {
  const { view, authOpen, codeModal, historyOpen } = useApp();

  useEffect(() => {
    const shadowRoot = document.getElementById('routecraft-userscript-host')?.shadowRoot;
    const scroller = shadowRoot?.getElementById('root');
    if (scroller) scroller.scrollTo({ top: 0, behavior: 'auto' });
    else window.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

  return (
    <div className="app">
      <TopBar />
      {view === 'landing' ? <Landing /> : view === 'docs' ? <DocsView /> : <Composer />}
      {authOpen ? <AuthModal /> : null}
      {codeModal ? <CodeModal /> : null}
      {historyOpen ? <HistoryDrawer /> : null}
      <Toast />
    </div>
  );
};

export default App;
