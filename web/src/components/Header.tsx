import React from 'react';

interface HeaderProps {
  leftAction?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  rightActions?: React.ReactNode;
  sticky?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const Header: React.FC<HeaderProps> = ({
  leftAction,
  title,
  subtitle,
  rightActions,
  sticky = true,
  className = '',
  style,
}) => {
  return (
    <header
      className={`app-header no-print ${sticky ? 'sticky' : ''} ${className}`}
      style={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        minHeight: '64px',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--surface-color)',
        borderBottom: '1px solid var(--border-color)',
        zIndex: 50,
        ...style,
      }}
    >
      <div
        className="app-header-container"
        style={{
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Esquerda: Navegação / Botão Voltar / Menu (Touch target min 44x44px) */}
        <div
          className="app-header-left"
          style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: leftAction ? '44px' : 'auto',
            minHeight: '44px',
          }}
        >
          {leftAction}
        </div>

        {/* Centro: Título e Subtítulo Truncados */}
        <div
          className="app-header-center"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {typeof title === 'string' ? (
            <h1
              className="app-header-title"
              title={title}
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h1>
          ) : (
            title
          )}
          {subtitle && (
            typeof subtitle === 'string' ? (
              <span
                className="app-header-subtitle"
                title={subtitle}
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subtitle}
              </span>
            ) : (
              subtitle
            )
          )}
        </div>

        {/* Direita: Ações Secundárias / Ícones de Ação (Touch target min 44x44px) */}
        <div
          className="app-header-right"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: rightActions ? '44px' : 'auto',
            minHeight: '44px',
          }}
        >
          {rightActions}
        </div>
      </div>
    </header>
  );
};

