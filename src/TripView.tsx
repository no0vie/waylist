import { useState, type ReactNode } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Share2, Download, MapPin, Clock3, Route, GripVertical, Pencil, Trash2, ExternalLink, Copy, Coffee, Fuel, BedDouble, Flag, ParkingCircle, Camera, Leaf } from 'lucide-react';
import { affectedSegments, formatDuration, newPoint, pointTypes, providers, reconcileSegments, totals, tripSchema, type Point, type Segment, type Trip } from './model';
import { api } from './storage';
import { Modal, Field, Submit, formData, text, number, download, dateLabel } from './ui';

const icons = { START: Flag, FINISH: Flag, STOP: MapPin, FOOD: Coffee, FUEL: Fuel, REST: Leaf, HOTEL: BedDouble, ATTRACTION: Camera, PARKING: ParkingCircle, CUSTOM: MapPin };
function SortablePoint({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .5 : 1 }}>
    {children(disabled ? null : <button className="drag-handle icon-button" aria-label="Перетащить точку" {...attributes} {...listeners}><GripVertical size={18} /></button>)}
  </div>;
}
function PointForm({ point, save, close }: { point: Point; save: (point: Point) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="Точка маршрута" close={close}><form onSubmit={async e => {
    const data = formData(e); setBusy(true); setError('');
    try {
      const latitude = text(data, 'latitude'), longitude = text(data, 'longitude');
      if (Boolean(latitude) !== Boolean(longitude)) throw new Error('Укажите обе координаты или оставьте оба поля пустыми.');
      await save({ ...point, title: text(data, 'title'), type: text(data, 'type') as Point['type'], address: text(data, 'address'), description: text(data, 'description'), notes: text(data, 'notes'), duration: number(data, 'duration'), latitude: latitude ? Number(latitude) : null, longitude: longitude ? Number(longitude) : null, externalLinks: text(data, 'links').split('\n').map(s => s.trim()).filter(Boolean), arrivalTime: text(data, 'arrivalTime'), departureTime: text(data, 'departureTime') });
      close();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить'); } finally { setBusy(false); }
  }}>
    <Field label="Название"><input name="title" defaultValue={point.title} required maxLength={500} autoFocus /></Field>
    <div className="form-grid"><Field label="Тип остановки"><select name="type" defaultValue={point.type}>{Object.entries(pointTypes).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></Field><Field label="Остановка, минут"><input type="number" name="duration" min="0" max="10000000" step="1" defaultValue={point.duration} /></Field></div>
    <Field label="Адрес"><input name="address" defaultValue={point.address} maxLength={2000} placeholder="Город, улица или название места" /></Field>
    <Field label="Описание"><textarea name="description" defaultValue={point.description} maxLength={20000} rows={2} /></Field>
    <Field label="Заметки"><textarea name="notes" defaultValue={point.notes} maxLength={20000} rows={3} placeholder="Что важно не забыть?" /></Field>
    <details><summary>Координаты, время и ссылки</summary><div className="form-grid"><Field label="Широта"><input name="latitude" type="number" min="-90" max="90" step="any" defaultValue={point.latitude ?? ''} /></Field><Field label="Долгота"><input name="longitude" type="number" min="-180" max="180" step="any" defaultValue={point.longitude ?? ''} /></Field><Field label="Прибытие"><input name="arrivalTime" type="datetime-local" defaultValue={point.arrivalTime} /></Field><Field label="Отправление"><input name="departureTime" type="datetime-local" defaultValue={point.departureTime} /></Field></div><Field label="Ссылки HTTP(S), по одной на строке"><textarea name="links" defaultValue={point.externalLinks.join('\n')} rows={3} /></Field></details>
    {error && <p className="error" role="alert">{error}</p>}<div className="form-footer"><button type="button" className="button" onClick={close}>Отмена</button><Submit busy={busy} /></div>
  </form></Modal>;
}
function SegmentForm({ segment, save, close }: { segment: Segment; save: (segment: Segment) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="Участок пути" close={close}><p className="muted">Укажите данные вручную. Ссылка откроет именно тот маршрут, который вы сохранили.</p><form onSubmit={async e => {
    const data = formData(e); setBusy(true);
    try { await save({ ...segment, distance: number(data, 'distance'), duration: number(data, 'duration'), navigationUrl: text(data, 'navigationUrl'), navigationProvider: text(data, 'navigationProvider') as Segment['navigationProvider'], notes: text(data, 'notes') }); close(); }
    catch { setError('Проверьте данные. Ссылка должна начинаться с http:// или https://.'); } finally { setBusy(false); }
  }}><div className="form-grid"><Field label="Расстояние, км"><input name="distance" type="number" min="0" max="10000000" step="any" defaultValue={segment.distance} autoFocus required /></Field><Field label="Время в пути, минут"><input name="duration" type="number" min="0" max="10000000" defaultValue={segment.duration} required /></Field></div>
    <Field label="Картографический сервис"><select name="navigationProvider" defaultValue={segment.navigationProvider}>{providers.map(p => <option key={p}>{p}</option>)}</select></Field>
    <Field label="Ссылка на навигацию"><input name="navigationUrl" type="url" maxLength={2048} defaultValue={segment.navigationUrl} placeholder="https://…" /></Field>
    <Field label="Заметки об участке"><textarea name="notes" defaultValue={segment.notes} maxLength={20000} rows={3} /></Field>
    {error && <p className="error" role="alert">{error}</p>}<div className="form-footer"><Submit busy={busy} /></div>
  </form></Modal>;
}
function ShareDialog({ trip, close, sync, pending }: { trip: Trip; close: () => void; sync: () => Promise<void>; pending: boolean }) {
  const [url, setUrl] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setMessage('');
    try { await sync(); if (pending) throw new Error('Сначала дождитесь синхронизации и повторите создание ссылки.'); setUrl((await api<{ url: string }>(`/trips/${trip.id}/share`, { method: 'POST' })).url); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось создать ссылку'); } finally { setBusy(false); }
  }
  return <Modal title="Поделиться поездкой" close={close}><p className="muted">По ссылке маршрут доступен без регистрации, только для просмотра. Изменения появятся после синхронизации. Все заметки также будут видны.</p>
    {!url ? <button className="button primary" onClick={() => void create()} disabled={busy}>{busy ? 'Создаём…' : 'Создать ссылку'}</button> : <><Field label="Живая ссылка"><input readOnly value={url} onFocus={e => e.currentTarget.select()} /></Field><button className="button" onClick={() => { void navigator.clipboard.writeText(url).then(() => setMessage('Ссылка скопирована'), () => setMessage('Выделите и скопируйте ссылку вручную.')); }}><Copy size={16} />Копировать</button><form onSubmit={async e => {
      const data = formData(e); setBusy(true); setMessage('');
      try { await api(`/trips/${trip.id}/email`, { method: 'POST', body: JSON.stringify({ email: text(data, 'email') }) }); setMessage('Письмо отправлено.'); }
      catch (err) { setMessage(err instanceof Error ? err.message : 'Не удалось отправить письмо'); } finally { setBusy(false); }
    }}><Field label="Отправить по email"><input type="email" name="email" required placeholder="friend@example.com" /></Field><Submit busy={busy}>Отправить приглашение</Submit></form></>}
    {message && <p role="status" className="notice">{message}</p>}
  </Modal>;
}
export function TripView({ trip, save, back, readonly = false, sync = async () => {}, pending = false }: {
  trip: Trip; save?: (trip: Trip) => Promise<void>; back: () => void; readonly?: boolean; sync?: () => Promise<void>; pending?: boolean;
}) {
  const [point, setPoint] = useState<Point | null>(null); const [segment, setSegment] = useState<Segment | null>(null);
  const [editTrip, setEditTrip] = useState(false); const [share, setShare] = useState(false); const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState(''); const [mode, setMode] = useState<'timeline' | 'map'>('timeline');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const stats = totals(trip);
  async function persist(next: Trip) { tripSchema.parse(next); if (save) await save(next); }
  async function changePoints(points: Point[]) {
    const affected = affectedSegments(trip, points);
    if (affected && !confirm(`Будут сброшены данные ${affected} связанных участков: расстояние, время, ссылки и заметки. Продолжить? Перед этим можно экспортировать JSON.`)) return false;
    await persist(reconcileSegments(trip, points));
    setNotice('Порядок обновлён. Заполните новые участки и проверьте навигационные ссылки.'); return true;
  }
  const run = (task: Promise<unknown>) => { void task.catch(err => setNotice(err instanceof Error ? err.message : 'Не удалось сохранить изменения')); };
  function move(id: string, target: number) { const from = trip.points.findIndex(p => p.id === id); if (target >= 0 && target < trip.points.length) run(changePoints(arrayMove(trip.points, from, target))); }
  return <>
    <button className="back-link" onClick={back}><ArrowLeft size={16} />{readonly ? 'На главную' : 'Мои поездки'}</button>
    <div className="trip-heading"><div><div className="eyebrow">{readonly ? 'МАРШРУТ · ТОЛЬКО ПРОСМОТР' : 'ВАШЕ СЛЕДУЮЩЕЕ ПУТЕШЕСТВИЕ'}</div><h1>{trip.title}</h1><p className="muted">{dateLabel(trip.startDate)}{trip.status === 'archived' ? ' · В архиве' : ''}</p></div><div className="actions">{!readonly && <><button className="button" onClick={() => setEditTrip(true)}><Pencil size={16} />Изменить</button><button className="button primary" onClick={() => setShare(true)}><Share2 size={16} />Поделиться</button></>}<button className="button" onClick={() => download(trip, `${trip.title.replace(/[^\p{L}\p{N}_-]/gu, '_')}.json`)}><Download size={16} />JSON</button></div></div>
    <div className="stats"><div><Route /><strong>{stats.distance.toLocaleString('ru-RU')} <small>км</small></strong><span>весь маршрут</span></div><div><Clock3 /><strong>{formatDuration(stats.driving)}</strong><span>в движении</span></div><div><Coffee /><strong>{formatDuration(stats.stops)}</strong><span>{stats.stopCount} остановок</span></div><div><Flag /><strong>{formatDuration(stats.total)}</strong><span>всего в путешествии</span></div></div>
    {notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>Скрыть</button></div>}
    <div className="trip-layout"><section><div className="section-heading"><div className="tabs"><button className={mode === 'timeline' ? 'active' : ''} onClick={() => setMode('timeline')}>Маршрут</button><button className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')}>Схема</button></div><span className="muted">{stats.pointCount} точек · {stats.segmentCount} участков</span></div>
    {mode === 'map' ? <RouteDiagram trip={trip} /> : <>
      <input className="point-search" aria-label="Поиск точки в маршруте" placeholder="Найти точку в маршруте…" value={filter} onChange={e => setFilter(e.target.value)} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) move(String(active.id), trip.points.findIndex(p => p.id === over.id)); }}>
      <SortableContext items={trip.points.map(p => p.id)} strategy={verticalListSortingStrategy}><div className="timeline">
      {trip.points.map((p, i) => {
        const Icon = icons[p.type]; const s = trip.segments[i];
        if (filter && !`${p.title} ${p.address}`.toLowerCase().includes(filter.toLowerCase())) return null;
        return <SortablePoint key={p.id} id={p.id} disabled={readonly || !!filter}>{handle => <div className="timeline-item"><div className={`point-marker ${p.type === 'START' || p.type === 'FINISH' ? 'endpoint' : ''}`}><Icon size={19} /></div><article className="point-card"><div className="point-title"><div><span className="eyebrow">{String(i + 1).padStart(2, '0')} / {pointTypes[p.type]}</span><h3>{p.title}</h3></div>{handle}</div>{p.address && <p className="muted compact">{p.address}</p>}{p.description && <p className="compact">{p.description}</p>}{p.duration > 0 && <span className="badge"><Clock3 size={13} />{formatDuration(p.duration)}</span>}{p.notes && <p className="point-note">{p.notes}</p>}{(p.arrivalTime || p.departureTime) && <p className="muted compact">Прибытие: {p.arrivalTime.replace('T', ' ') || '—'} · Отправление: {p.departureTime.replace('T', ' ') || '—'}</p>}{p.latitude !== null && <p className="muted compact">{p.latitude}, {p.longitude}</p>}{p.externalLinks.map((link, idx) => <a className="external" href={link} key={idx} target="_blank" rel="noopener noreferrer">Ссылка {idx + 1}<ExternalLink size={13} /></a>)}
          {!readonly && <div className="point-actions"><button className="text-button" onClick={() => setPoint(p)}><Pencil size={14} />Изменить</button><button className="icon-button" title="Создать копию точки" aria-label={`Копировать ${p.title}`} onClick={() => setPoint({ ...p, id: crypto.randomUUID(), title: `${p.title} (копия)` })}><Copy size={15} /></button><button className="icon-button" disabled={i === 0} aria-label={`Поднять ${p.title}`} onClick={() => move(p.id, i - 1)}><ArrowUp size={15} /></button><button className="icon-button" disabled={i === trip.points.length - 1} aria-label={`Опустить ${p.title}`} onClick={() => move(p.id, i + 1)}><ArrowDown size={15} /></button><button className="icon-button danger" aria-label={`Удалить ${p.title}`} onClick={() => { if (confirm(`Удалить точку «${p.title}»?`)) run(changePoints(trip.points.filter(value => value.id !== p.id))); }}><Trash2 size={15} /></button></div>}
        </article>{s && <div className="segment"><div className="segment-info"><Route size={15} /><strong>{s.distance} км</strong><span>·</span><span>{formatDuration(s.duration)}</span>{!readonly && <button className="icon-button" aria-label={`Изменить участок ${p.title} — ${trip.points[i + 1]?.title}`} onClick={() => setSegment(s)}><Pencil size={14} /></button>}</div>{s.notes && <p className="muted compact">{s.notes}</p>}{s.navigationUrl ? <a className="navigation-link" href={s.navigationUrl} target="_blank" rel="noopener noreferrer">Навигация · {s.navigationProvider}<ExternalLink size={13} /></a> : <span className="muted small">Навигация не добавлена</span>}</div>}</div>}</SortablePoint>;
      })}
      </div></SortableContext></DndContext>
      {!trip.points.length && <div className="empty small-empty"><MapPin size={32} /><h3>С чего начнётся путешествие?</h3><p>Добавьте первую точку маршрута.</p></div>}
      {!readonly && <button className="add-point" onClick={() => setPoint(newPoint(trip.id, trip.points.length ? 'STOP' : 'START'))}><Plus size={19} />Добавить точку</button>}
    </>}
    </section><aside><div className="aside-card"><div className="eyebrow">ПЛАН ПУТЕШЕСТВИЯ</div><h3>Дорога начинается с идеи.</h3><p>{trip.description || 'Соберите любимые места, оставьте время на кофе и наслаждайтесь дорогой.'}</p><div className="mini-route"><span>○</span><div>{trip.points[0]?.title || 'Старт'}<div className="mini-line" />{trip.points.at(-1)?.title || 'Финиш'}</div><span>⚑</span></div></div><div className="aside-card notes"><div className="section-heading"><h3>Заметки к поездке</h3>{!readonly && <button className="icon-button" aria-label="Редактировать заметки поездки" onClick={() => setEditTrip(true)}><Pencil size={16} /></button>}</div><p className="preserve">{trip.notes || 'Здесь можно сохранить список вещей, важные телефоны и всё, что пригодится в дороге.'}</p></div><p className="aside-tip"><Leaf size={18} />Не торопитесь. Лучшие моменты часто случаются между точками маршрута.</p></aside></div>
    {point && <PointForm point={point} close={() => setPoint(null)} save={async updated => {
      const exists = trip.points.some(p => p.id === updated.id);
      if (exists) await persist({ ...trip, points: trip.points.map(p => p.id === updated.id ? updated : p) });
      else { const points = [...trip.points]; const index = points.at(-1)?.type === 'FINISH' ? points.length - 1 : points.length; points.splice(index, 0, updated); if (!(await changePoints(points))) throw new Error('Добавление отменено; существующие участки сохранены.'); }
    }} />}
    {segment && <SegmentForm segment={segment} close={() => setSegment(null)} save={async updated => persist({ ...trip, segments: trip.segments.map(s => s.id === updated.id ? updated : s) })} />}
    {share && <ShareDialog trip={trip} close={() => setShare(false)} sync={sync} pending={pending} />}
    {editTrip && <TripForm trip={trip} save={persist} close={() => setEditTrip(false)} />}
  </>;
}
function TripForm({ trip, save, close }: { trip: Trip; save: (trip: Trip) => Promise<void>; close: () => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Modal title="О поездке" close={close}><form onSubmit={async e => {
    const data = formData(e); setBusy(true);
    try { await save({ ...trip, title: text(data, 'title'), startDate: text(data, 'startDate'), description: text(data, 'description'), notes: text(data, 'notes') }); close(); }
    catch { setError('Не удалось сохранить. Проверьте поля и доступ к локальному хранилищу.'); } finally { setBusy(false); }
  }}><Field label="Название"><input required name="title" defaultValue={trip.title} maxLength={500} autoFocus /></Field><Field label="Дата отправления"><input name="startDate" type="date" defaultValue={trip.startDate} /></Field><Field label="Описание"><textarea name="description" defaultValue={trip.description} maxLength={20000} rows={3} /></Field><Field label="Заметки к поездке"><textarea name="notes" defaultValue={trip.notes} maxLength={20000} rows={5} /></Field>{error && <p className="error" role="alert">{error}</p>}<div className="form-footer"><Submit busy={busy} /></div></form></Modal>;
}
function RouteDiagram({ trip }: { trip: Trip }) {
  const points = trip.points.filter(p => p.latitude !== null && p.longitude !== null);
  if (!points.length) return <div className="empty small-empty"><MapPin size={36} /><h3>Добавьте координаты</h3><p>Схема покажет порядок точек. Это не автомобильная карта и не навигатор.</p></div>;
  const xs = points.map(p => p.longitude!), ys = points.map(p => p.latitude!);
  const minX = Math.min(...xs), minY = Math.min(...ys), dx = Math.max(...xs) - minX || 1, dy = Math.max(...ys) - minY || 1;
  const positions = points.map(p => ({ x: 60 + (p.longitude! - minX) / dx * 480, y: 300 - (p.latitude! - minY) / dy * 240 }));
  return <div className="diagram"><svg viewBox="0 0 600 360" role="img" aria-label="Схема порядка точек по координатам"><polyline points={positions.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6 5" />{positions.map((p, i) => <g key={points[i].id}><circle cx={p.x} cy={p.y} r="16" fill="currentColor" /><text x={p.x} y={p.y + 5} textAnchor="middle" fill="white" fontSize="13">{trip.points.indexOf(points[i]) + 1}</text><title>{points[i].title}</title></g>)}</svg><p className="muted">Условная схема, не дорожный маршрут. Без координат: {trip.points.length - points.length}.</p><ol>{trip.points.map(p => <li key={p.id}>{p.title}{p.latitude === null ? ' — без координат' : ''}</li>)}</ol></div>;
}
