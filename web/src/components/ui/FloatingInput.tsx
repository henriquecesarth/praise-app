import React, { useId } from 'react';

interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FloatingInput: React.FC<FloatingInputProps> = ({
  label,
  id,
  error,
  className = '',
  style,
  value,
  type = 'text',
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || `floating-input-${generatedId}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="relative w-full">
      <input
        id={inputId}
        type={type}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : props['aria-describedby']}
        style={{
          paddingLeft: '16px',
          paddingRight: '16px',
          paddingTop: '16px',
          paddingBottom: '10px',
          boxSizing: 'border-box',
          ...style,
        }}
        className={`w-full min-h-[50px] text-sm md:text-base leading-normal text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg outline-none transition-colors duration-150 focus:border-[var(--focus-ring)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 ${
          error ? 'border-[var(--status-danger-text)]' : ''
        } ${className}`}
        {...props}
      />
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
