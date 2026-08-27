import React, { useId } from 'react';

interface FloatingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export const FloatingTextarea: React.FC<FloatingTextareaProps> = ({
  label,
  id,
  error,
  className = '',
  style,
  value,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id || `floating-textarea-${generatedId}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="relative w-full">
      <textarea
        id={inputId}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : props['aria-describedby']}
        style={{
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '28px',
          paddingBottom: '12px',
          boxSizing: 'border-box',
          ...style,
        }}
        className={`w-full min-h-[120px] text-sm md:text-base leading-relaxed text-[var(--text-primary)] bg-[var(--surface-variant)] border border-[var(--border-color)] rounded-xl outline-none transition-all duration-200 focus:border-[var(--primary-light)] focus:bg-[var(--surface-color)] resize-y ${
          error ? 'border-red-500' : ''
        } ${className}`}
        {...props}
      />
      <label
        htmlFor={inputId}
        className="absolute pointer-events-none transition-all duration-200 ease-in-out z-10 px-1.5 rounded top-0 -translate-y-1/2 left-3.5 text-xs font-semibold text-[var(--primary-light)] bg-[var(--surface-color)]"
      >
        {label}
      </label>
      {error && <span id={errorId} className="text-xs text-red-500 mt-1 block px-1">{error}</span>}
    </div>
  );
};
