'use client';

/**
 * Country picker: the flag and name in the field, a searchable list with flags when opened.
 * The list is drawn on the page itself (a portal, fixed to the field), so the card around the form never clips it, and it
 * opens upwards when there is more room above. Keyboard: ↑ ↓ to move, Enter to choose, Esc to close, or just type to search.
 * `countries`: [{ code, name, flag }]. `value`: the chosen ISO code ('' when none).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from './icons';

const MAX_HEIGHT = 340;
const GAP = 6;

export default function CountrySelect({ id, value, onChange, onBlur, countries, placeholder = 'Choose a country', invalid }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const selected = countries.find((c) => c.code === value);

  // names starting with the search text first, then names containing it
  const shown = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return countries;
    const starts = [];
    const has = [];
    for (const c of countries) {
      const n = c.name.toLowerCase();
      if (n.startsWith(t) || c.code.toLowerCase() === t) starts.push(c);
      else if (n.includes(t)) has.push(c);
    }
    return [...starts, ...has];
  }, [query, countries]);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - 12;
    const above = r.top - GAP - 12;
    const up = below < 240 && above > below;
    const room = up ? above : below;
    const width = Math.max(r.width, 260);
    setPos({
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      width: Math.min(width, window.innerWidth - 16),
      maxHeight: Math.max(180, Math.min(MAX_HEIGHT, room)),
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP })
    });
  };

  const close = (refocus = false) => {
    setOpen(false);
    setQuery('');
    onBlur?.();
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (c) => {
    onChange(c.code);
    close(true);
  };

  const openList = () => {
    place();
    setQuery('');
    setActive(Math.max(0, countries.findIndex((c) => c.code === value)));
    setOpen(true);
  };

  // while open: keep the list on its field, close on outside click, focus the search box
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!popRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) close();
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the highlighted row stays in view
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`cs-trigger${selected ? '' : ' is-empty'}${open ? ' is-open' : ''}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openList();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
      >
        {selected && (
          <span className="cs-flag" aria-hidden="true">
            {selected.flag}
          </span>
        )}
        <span className="cs-value">{selected ? selected.name : placeholder}</span>
        <svg className="cs-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="cs-pop" style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }} role="dialog" aria-label="Choose a country">
            <div className="cs-search">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                placeholder="Search country"
                aria-label="Search country"
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={shown[active] ? `${id}-opt-${shown[active].code}` : undefined}
              />
            </div>
            <ul ref={listRef} id={`${id}-list`} className="cs-list" role="listbox">
              {shown.length === 0 && <li className="cs-empty">No country found</li>}
              {shown.map((c, i) => (
                <li
                  key={c.code}
                  id={`${id}-opt-${c.code}`}
                  role="option"
                  aria-selected={c.code === value}
                  data-active={i === active}
                  className={`cs-opt${i === active ? ' is-active' : ''}${c.code === value ? ' is-selected' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                >
                  <span className="cs-flag" aria-hidden="true">
                    {c.flag}
                  </span>
                  <span className="cs-name">{c.name}</span>
                  {c.code === value && (
                    <span className="cs-check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
