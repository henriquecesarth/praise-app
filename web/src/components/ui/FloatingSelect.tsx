import React, { useState } from 'react';

interface FloatingSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
}

export const FloatingSelect: React.FC<FloatingSelectProps> = ({
  label,
  id,
  error,
  className = '',
  style,
  value,
  onFocus,
  onBlur,
  children,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
  const isFloating = isFocused || hasValue;

  const handleFocus = (e: React.FocusEvent<HTMLSelectElement>) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLSelectElement>) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  return (
    <div className="relative w-full">
      <select
        id={inputId}
        value={value}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          paddingLeft: '20px',
          paddingRight: '40px',
          paddingTop: '16px',
          paddingBottom: '10px',
          boxSizing: 'border-box',
          ...style,
        }}
        className={`w-full min-h-[54px] text-sm md:text-base leading-normal text-[var(--text-primary)] bg-[var(--surface-variant)] border border-[var(--border-color)] rounded-xl outline-none transition-all duration-200 focus:border-[var(--primary-light)] focus:bg-[var(--surface-color)] appearance-none cursor-pointer ${
          error ? 'border-red-500' : ''
        } ${className}`}
        {...props}
      >
        {children}
      </select>
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
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)] opacity-70">
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {error && <span className="text-xs text-red-500 mt-1 block px-1">{error}</span>}
    </div>
  );
};
