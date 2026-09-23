import { useEffect, useRef, type ReactNode, type FormEvent } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="modal-content"><header className="section-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Закрыть"><X size={20} /></button></header>{children}</div>
  </dialog>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function Submit({ busy, children = 'Сохранить' }: { busy?: boolean; children?: ReactNode }) {
  return <button className="button primary" disabled={busy} type="submit">{busy ? 'Подождите…' : children}</button>;
}
export function formData(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
export const text = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
export const number = (data: FormData, key: string) => Number(data.get(key) || 0);
export function download(trip: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dateLabel(value: string) {
  if (!value) return 'Дата не выбрана';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
