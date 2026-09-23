import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Search, Upload, ArrowUpRight, Route, MapPin, CalendarDays, Archive, Copy, Trash2, LogOut, WifiOff, RefreshCw, Compass, FolderHeart } from 'lucide-react';
import { config } from './config';
import { duplicateTrip, formatDuration, newTrip, parseImport, totals, tripSchema, type Trip, type User } from './model';
import { api, cachedUser, forgetUser, rememberUser, useTrips } from './storage';
import { TripView } from './TripView';
import { Field, Modal, Submit, dateLabel, formData, text } from './ui';

function Brand() { return <a href="/" className="brand"><span><Route size={23} /></span>{config.name}<i>планы на дорогу</i></a>; }
function Shell({ children, user, logout, online }: { children: ReactNode; user?: User; logout?: () => void; online: boolean }) {
  return <><header className="topbar"><div className="topbar-inner"><Brand /><div className="account">{!online && <span className="offline"><WifiOff size={15} />Без сети</span>}{user && <><span className="avatar">{user.email[0].toUpperCase()}</span><span className="account-email">{user.email}</span><button className="icon-button" aria-label="Выйти" onClick={logout}><LogOut size={18} /></button></>}</div></div></header><main>{children}</main><footer className="site-footer"><span>{config.name} · Меньше суеты, больше путешествий.</span><span>Route planning first. Map second.</span></footer></>;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [shared, setShared] = useState<Trip | null>(null);
  const shareToken = location.pathname.startsWith('/share/') ? location.pathname.split('/')[2] : null;
  const started = useRef(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (started.current) return; started.current = true;
    void (async () => {
      try {
        if (shareToken) {
          const response = await api<{ trip: Trip }>(`/shares/${encodeURIComponent(shareToken)}`);
          setShared(tripSchema.parse(response.trip)); return;
        }
        const magicToken = location.pathname === '/auth/magic' ? new URLSearchParams(location.hash.slice(1)).get('token') : null;
        const response = magicToken ? await api<{ user: User }>('/auth/magic/verify', { method: 'POST', body: JSON.stringify({ token: magicToken }) }) : await api<{ user: User | null }>('/auth/me');
        if (magicToken) history.replaceState(null, '', '/');
        setUser(response.user);
        if (response.user) await rememberUser(response.user); else await forgetUser();
      } catch (err) {
        if (!shareToken && location.pathname !== '/auth/magic') {
          const cached = await cachedUser().catch(() => undefined);
          if (cached) { setUser(cached); setError('Сервер недоступен. Открыта локальная копия; для синхронизации может потребоваться повторный вход.'); }
          else setError('Не удалось подключиться к API. Проверьте соединение и запущен ли сервер.');
        } else setError(err instanceof Error ? err.message : 'Не удалось открыть ссылку');
      } finally { setLoading(false); }
    })();
  }, [shareToken]);
  async function loggedIn(account: User) { await rememberUser(account); setUser(account); setError(''); }
  async function logout() {
    if (!confirm('Выйти из аккаунта? Локальные данные останутся в этом браузере. Если есть несинхронизированные правки, войдите снова в тот же аккаунт, чтобы отправить их.')) return;
    try { await api('/auth/logout', { method: 'POST' }); await forgetUser(); setUser(null); }
    catch { setError('Для безопасного завершения серверной сессии необходимо соединение. Повторите выход, когда сервер доступен.'); }
  }
  return <Shell user={shareToken ? undefined : user ?? undefined} logout={() => void logout()} online={online}>
    {error && <div className="notice" role="alert">{error}<button className="text-button" onClick={() => location.reload()}>Повторить</button></div>}
    {loading ? <div className="empty"><RefreshCw className="spin" /><p>Собираем планы в дорогу…</p></div> : shareToken ? shared ? <TripView trip={shared} readonly back={() => { location.href = '/'; }} /> : <div className="empty"><h1>Маршрут недоступен</h1><p>Ссылка может быть неверной или поездка удалена.</p><a href="/" className="button">На главную</a></div> : user ? <Workspace key={user.id} user={user} /> : <Auth onLogin={loggedIn} />}
  </Shell>;
}
function Auth({ onLogin }: { onLogin: (user: User) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'magic'>('login');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <div className="auth-layout"><section className="auth-intro"><div className="eyebrow">ДЛЯ ТЕХ, КТО ЛЮБИТ ДОРОГУ</div><h1>Хорошая поездка<br />начинается<br /><em>с простого плана.</em></h1><p>Остановки на кофе, красивые места и каждый участок пути. Соберите всё в одном маршруте — и отправляйтесь навстречу новому.</p><div className="journey-art" aria-hidden="true"><span className="art-point"><FlagIcon />Старт</span><div className="art-track" /><span className="art-stop">☕ Пауза на кофе <small>20 мин · никуда не спешим</small></span><div className="art-track short" /><span className="art-point finish"><MapPin size={18} />Новые впечатления</span></div><div className="auth-benefits"><span>✓ Ваш маршрут, ваши правила</span><span>✓ Доступ к планам без сети</span></div></section><section className="auth-card"><div className="eyebrow">РАДЫ ВАС ВИДЕТЬ</div><h2>{mode === 'register' ? 'Начнём путешествие' : mode === 'magic' ? 'Вход без пароля' : 'С возвращением'}</h2><p className="muted">{mode === 'magic' ? 'Отправим одноразовую ссылку на вашу почту.' : 'Ваши планы и новые дороги уже ждут.'}</p><form onSubmit={async e => {
    const data = formData(e); setBusy(true); setMessage('');
    try {
      const email = text(data, 'email');
      if (mode === 'magic') { await api('/auth/magic/request', { method: 'POST', body: JSON.stringify({ email }) }); setMessage('Ссылка отправлена на почту и действует 15 минут.'); }
      else { const response = await api<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password: String(data.get('password') || '') }) }); await onLogin(response.user); }
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось подключиться к серверу'); } finally { setBusy(false); }
  }}><Field label="Email"><input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" /></Field>{mode !== 'magic' && <Field label="Пароль · от 10 символов"><input name="password" type="password" required minLength={10} maxLength={72} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="Не менее 10 символов" /></Field>}{message && <p className="notice" role="status">{message}</p>}<Submit busy={busy}>{mode === 'register' ? 'Создать аккаунт' : mode === 'magic' ? 'Получить ссылку' : 'Войти'}</Submit></form><div className="auth-switch"><button className="text-button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setMessage(''); }}>{mode === 'register' ? 'Уже есть аккаунт? Войти' : 'Впервые здесь? Создать аккаунт'}</button><button className="text-button" onClick={() => { setMode(mode === 'magic' ? 'login' : 'magic'); setMessage(''); }}>{mode === 'magic' ? 'Войти с паролем' : 'Войти по ссылке из письма'}</button></div></section></div>;
}
function FlagIcon() { return <Route size={18} />; }
function Workspace({ user }: { user: User }) {
  const store = useTrips(user.id);
  const [selected, setSelected] = useState<string | null>(null), [create, setCreate] = useState(false);
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [sort, setSort] = useState('updated');
  const [message, setMessage] = useState(''); const fileInput = useRef<HTMLInputElement>(null);
  const selectedTrip = store.trips.find(t => t.id === selected);
  const filtered = store.trips.filter(t => (t.status === 'archived') === archived && `${t.title} ${t.description}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ru') : sort === 'date' ? (a.startDate || '9999').localeCompare(b.startDate || '9999') : b.updatedAt.localeCompare(a.updatedAt));
  const run = (task: Promise<unknown>) => { void task.catch(err => setMessage(err instanceof Error ? err.message : 'Не удалось выполнить действие')); };
  return <>
    <div className="sync-status" role="status"><span className={`status-dot ${store.pending ? 'pending' : ''}`} />{store.syncing ? 'Синхронизация…' : store.pending ? `Сохранено на устройстве · ожидают отправки: ${store.pending}` : 'Изменения сохранены'}<button className="text-button" disabled={store.syncing} onClick={() => run(store.sync())}><RefreshCw size={13} />Обновить</button></div>
    {(store.error || message) && <div className="notice" role="alert">{message || store.error}{message && <button className="text-button" onClick={() => setMessage('')}>Скрыть</button>}</div>}
    {store.conflicts.map(id => <div key={id} className="conflict"><strong>{store.trips.find(t => t.id === id)?.title || 'Удалённая поездка'}: конфликт версий</strong><p>Экспортируйте локальную версию в JSON, если хотите сохранить обе. Выбор заменит одну из версий.</p><button className="button" onClick={() => { if (confirm('Отбросить локальные правки и загрузить версию сервера?')) run(store.resolveConflict(id, 'server')); }}>Взять с сервера</button><button className="button" onClick={() => { if (confirm('Заменить серверную версию локальными правками?')) run(store.resolveConflict(id, 'local')); }}>Оставить локальную</button></div>)}
    {store.loading ? <div className="empty">Загружаем поездки…</div> : selectedTrip ? <TripView key={selectedTrip.id} trip={selectedTrip} save={store.save} back={() => setSelected(null)} sync={store.sync} pending={!!store.changes[selectedTrip.id]} /> : <>
      <div className="dashboard-heading"><div><div className="eyebrow">СОБИРАЙТЕ МОМЕНТЫ, А НЕ ВКЛАДКИ</div><h1>Мои поездки<span className="title-dot">.</span></h1><p className="muted">Большие приключения начинаются с маленького плана.</p></div><button className="button primary" onClick={() => setCreate(true)}><Plus size={18} />Новая поездка</button></div>
      <div className="dashboard-banner"><div><span className="eyebrow">ВПЕРЕДИ — ЦЕЛЫЙ МИР</span><h2>Не просто доехать.<br />Побывать по-настоящему.</h2><p>Спланируйте путь, найдите время на остановки<br />и оставьте место для спонтанности.</p></div><div className="banner-road" aria-hidden="true"><div className="road-orbit" /><span className="road-start"><MapPin /></span><span className="road-coffee">☕</span><span className="road-finish"><Compass size={34} /></span><span className="road-label">куда отправимся?</span></div></div>
      <div className="toolbar"><div className="tabs"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Предстоящие <span>{store.trips.filter(t => t.status === 'active').length}</span></button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}><Archive size={15} />Архив</button></div><div className="toolbar-tools"><label className="search"><Search size={16} /><input aria-label="Поиск поездок" placeholder="Найти поездку" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Сортировка поездок" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">Недавно изменённые</option><option value="date">По дате поездки</option><option value="title">По названию</option></select><button className="button" onClick={() => fileInput.current?.click()}><Upload size={16} />Импорт</button></div></div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; run((async () => { if (file.size > 2_000_000) throw new Error('Максимальный размер файла — 2 МБ.'); const trip = parseImport(await file.text(), user.id); await store.save(trip); setSelected(trip.id); })()); }} />
      {filtered.length ? <div className="trip-grid">{filtered.map((trip, index) => { const stats = totals(trip); return <article key={trip.id} className="trip-tile"><button className={`tile-cover cover-${index % 3}`} onClick={() => setSelected(trip.id)} aria-label={`Открыть ${trip.title}`}><span className="cover-lines" /><span className="cover-badge"><Route size={14} />Автомаршрут</span><span className="cover-number">{String(index + 1).padStart(2, '0')}</span><ArrowUpRight className="tile-arrow" /></button><div className="tile-body"><div className="tile-date"><CalendarDays size={14} />{dateLabel(trip.startDate)}</div><button className="tile-title" onClick={() => setSelected(trip.id)}>{trip.title}</button><p className="tile-description">{trip.description || `${trip.points[0]?.title || 'Старт'} → ${trip.points.at(-1)?.title || 'Финиш'}`}</p><div className="tile-stats"><span><Route size={14} />{stats.distance.toLocaleString('ru-RU')} км</span><span>{formatDuration(stats.total)}</span><span>{stats.stopCount} остановок</span></div><div className="tile-footer"><button className="text-button" onClick={() => setSelected(trip.id)}>Открыть маршрут<ArrowUpRight size={15} /></button><div className="actions"><button className="icon-button" aria-label={`Дублировать ${trip.title}`} title="Дублировать" onClick={() => { const copy = duplicateTrip(trip, user.id); copy.title += ' (копия)'; run(store.save(copy)); }}><Copy size={15} /></button><button className="icon-button" aria-label={archived ? 'Вернуть из архива' : 'В архив'} title={archived ? 'Вернуть из архива' : 'В архив'} onClick={() => run(store.save({ ...trip, status: archived ? 'active' : 'archived' }))}><Archive size={15} /></button><button className="icon-button danger" aria-label={`Удалить ${trip.title}`} title="Удалить" onClick={() => { if (confirm(`Удалить поездку «${trip.title}»? Ссылка для просмотра тоже перестанет работать.`)) run(store.remove(trip.id)); }}><Trash2 size={15} /></button></div></div></div></article>; })}<button className="new-trip-tile" onClick={() => setCreate(true)}><span><Plus size={25} /></span><strong>Новая история</strong><p>Куда дорога позовёт на этот раз?</p></button></div> : <div className="empty"><FolderHeart size={44} /><h2>{query ? 'Ничего не нашлось' : archived ? 'В архиве пока пусто' : 'Ваша первая история впереди'}</h2><p>{query ? 'Попробуйте другое название.' : archived ? 'Здесь будут храниться завершённые поездки.' : 'Добавьте старт, финиш и пару приятных остановок. Остальное сложится по дороге.'}</p>{!query && !archived && <button className="button primary" onClick={() => setCreate(true)}><Plus size={16} />Создать поездку</button>}</div>}
    </>}
    {create && <CreateTrip user={user} close={() => setCreate(false)} save={async trip => { await store.save(trip); setSelected(trip.id); setCreate(false); }} />}
  </>;
}
function CreateTrip({ user, close, save }: { user: User; close: () => void; save: (trip: Trip) => Promise<void> }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Modal title="Куда отправимся?" close={close}><p className="muted">Начните с главного. Промежуточные точки можно добавить позже.</p><form onSubmit={async e => {
    const data = formData(e); setBusy(true);
    try { const trip = newTrip(user.id, text(data, 'title'), text(data, 'start'), text(data, 'finish')); trip.startDate = text(data, 'date'); tripSchema.parse(trip); await save(trip); }
    catch { setError('Не удалось сохранить поездку. Проверьте поля и доступ к хранилищу браузера.'); } finally { setBusy(false); }
  }}><Field label="Название поездки"><input name="title" required maxLength={500} placeholder="Выходные у моря" autoFocus /></Field><div className="form-grid"><Field label="Откуда"><input name="start" required maxLength={500} placeholder="Москва" /></Field><Field label="Куда"><input name="finish" required maxLength={500} placeholder="Санкт-Петербург" /></Field></div><Field label="Дата отправления"><input name="date" type="date" /></Field>{error && <p className="error" role="alert">{error}</p>}<div className="form-footer"><Submit busy={busy}>Создать маршрут</Submit></div></form></Modal>;
}
