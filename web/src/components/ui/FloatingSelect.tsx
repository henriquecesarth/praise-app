import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

interface FloatingSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options?: { value: string; label: string }[];
  error?: string;
}

export const FloatingSelect: React.FC<FloatingSelectProps> = ({
  label,
  options,
  children,
  id,
  error,
  className = '',
  style,
  value,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || `floating-select-${generatedId}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="relative w-full">
      <div className="relative">
        <select
          id={inputId}
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : props['aria-describedby']}
          style={{
            paddingLeft: '16px',
            paddingRight: '40px',
            paddingTop: '16px',
            paddingBottom: '10px',
            boxSizing: 'border-box',
            ...style,
          }}
          className={`w-full min-h-[50px] text-sm md:text-base leading-normal text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg outline-none transition-colors duration-150 focus:border-[var(--focus-ring)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 appearance-none cursor-pointer ${
            error ? 'border-[var(--status-danger-text)]' : ''
          } ${className}`}
          {...props}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[var(--bg-surface)] text-[var(--text-primary)]">
                  {opt.label}
                </option>
              ))
            : children}
        </select>

        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]">
          <ChevronDown size={18} />
        </div>
      </div>

      <label
        htmlFor={inputId}
        className="absolute pointer-events-none transition-all duration-150 ease-in-out z-10 px-1.5 rounded top-0 -translate-y-1/2 left-3 text-xs font-semibold text-[var(--text-secondary)] bg-[var(--bg-surface)]"
      >
        {label}
      </label>

      {error && <span id={errorId} className="text-xs text-[var(--status-danger-text)] mt-1 block px-1">{error}</span>}
    </div>
  );
};
