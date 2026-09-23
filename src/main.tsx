import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRegisterSW } from 'virtual:pwa-register/react';
import App from './App';
import { config } from './config';
import './styles.css';

document.title = config.name;
function PwaUpdate() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const [error, setError] = useState('');
  if (!needRefresh) return null;
  return <div className="notice" style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 10, maxWidth: 340 }} role="status">Доступна новая версия. Сохраните открытые формы перед обновлением.
    <div className="actions"><button className="text-button" onClick={() => { void updateServiceWorker(true).catch(() => setError('Не удалось обновить. Попробуйте позже.')); }}>Обновить</button><button className="text-button" onClick={() => setNeedRefresh(false)}>Позже</button></div>{error}
  </div>;
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main><h1>Не удалось открыть приложение</h1><p>Перезагрузите страницу. Сохранённые маршруты останутся в локальном хранилище.</p><button className="button" onClick={() => location.reload()}>Перезагрузить</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /><PwaUpdate /></ErrorBoundary></React.StrictMode>);
