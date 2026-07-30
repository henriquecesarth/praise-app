import React, { useState } from 'react';

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
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  const isFloating = isFocused || hasValue;

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  return (
    <div className="relative w-full">
      <input
        id={inputId}
        type={type}
        value={value}
        onFocus={handleFocus}
        onBlur={handleBlur}
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
        className={`absolute pointer-events-none transition-all duration-200 ease-in-out z-10 px-1.5 rounded ${
          isFloating
            ? 'top-0 -translate-y-1/2 left-3.5 text-xs font-semibold text-[var(--primary-light)] bg-[var(--surface-color)]'
            : 'top-1/2 -translate-y-1/2 left-5 text-sm text-[var(--text-secondary)] bg-transparent'
        }`}
      >
        {label}
      </label>
      {error && <span className="text-xs text-red-500 mt-1 block px-1">{error}</span>}
    </div>
  );
};
