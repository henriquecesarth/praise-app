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
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '16px',
          paddingBottom: '10px',
          boxSizing: 'border-box',
          ...style,
        }}
        className={`w-full min-h-[54px] text-sm md:text-base leading-normal text-[var(--text-primary)] bg-[var(--surface-variant)] border border-[var(--border-color)] rounded-xl outline-none transition-all duration-200 focus:border-[var(--primary-light)] focus:bg-[var(--surface-color)] ${
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
