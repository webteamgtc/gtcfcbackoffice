'use client';

/**
 * Calendar date picker. Value is an ISO date string (YYYY-MM-DD), shown as dd/mm/yyyy.
 * Month and year are dropdowns, so a date of birth is a few clicks instead of paging through months.
 * `initialView` (ISO date) is the month shown first when nothing is chosen; `min` / `max` disable days outside the range.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

export default function DatePicker({ id, value, onChange, onBlur, min = '1900-01-01', max, initialView, placeholder = 'dd/mm/yyyy', invalid }) {
  const now = new Date();
  const selected = parse(value);
  const minP = parse(min);
  const maxP = parse(max) ?? { y: now.getFullYear() + 20, m: 11, d: 31 };
  const first = selected ?? parse(initialView) ?? { y: Math.min(now.getFullYear(), maxP.y), m: now.getMonth(), d: 1 };

  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: first.y, m: first.m });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  const close = () => {
    setOpen(false);
    onBlur?.();
  };

  // close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = () => {
    if (open) return close();
    setView({ y: first.y, m: first.m });
    setOpen(true);
  };

  const minYear = minP?.y ?? 1900;
  const years = [];
  for (let y = maxP.y; y >= minYear; y--) years.push(y);

  const step = (delta) =>
    setView(({ y, m }) => {
      const t = y * 12 + m + delta;
      const ny = Math.floor(t / 12);
      if (ny < minYear || ny > maxP.y) return { y, m };
      return { y: ny, m: t - ny * 12 };
    });

  const offset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const valueIso = selected ? toIso(selected.y, selected.m, selected.d) : '';
  const todayIso = toIso(now.getFullYear(), now.getMonth(), now.getDate());

  const outOfRange = (iso) => (min && iso < min) || (max && iso > max);

  return (
    <div className="dp" ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`dp-trigger${selected ? '' : ' is-empty'}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
      >
        <span>{selected ? `${pad(selected.d)}/${pad(selected.m + 1)}/${selected.y}` : placeholder}</span>
        <CalendarIcon />
      </button>

      {open && (
        <div className="dp-pop" role="dialog" aria-label="Choose a date">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeftIcon />
            </button>
            <select value={view.m} onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))} aria-label="Month">
              {MONTHS.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <select value={view.y} onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))} aria-label="Year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button type="button" className="dp-nav" onClick={() => step(1)} aria-label="Next month">
              <ChevronRightIcon />
            </button>
          </div>

          <div className="dp-grid">
            {WEEK.map((w) => (
              <span key={w} className="dp-week">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const iso = toIso(view.y, view.m, d);
              const cls = ['dp-day', iso === valueIso && 'is-selected', iso === todayIso && 'is-today'].filter(Boolean).join(' ');
              return (
                <button
                  key={iso}
                  type="button"
                  className={cls}
                  disabled={outOfRange(iso)}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                    onBlur?.();
                    triggerRef.current?.focus();
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
