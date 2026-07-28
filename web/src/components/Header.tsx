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
      style={style}
    >
      <div className="app-header-container">
        {/* Esquerda: Navegação / Botão Voltar / Menu */}
        <div className="app-header-left">
          {leftAction}
        </div>

        {/* Centro: Título e Subtítulo Truncados */}
        <div className="app-header-center">
          {typeof title === 'string' ? (
            <h1 className="app-header-title" title={title}>
              {title}
            </h1>
          ) : (
            title
          )}
          {subtitle && (
            typeof subtitle === 'string' ? (
              <span className="app-header-subtitle" title={subtitle}>
                {subtitle}
              </span>
            ) : (
              subtitle
            )
          )}
        </div>

        {/* Direita: Ações Secundárias / Ícones de Ação */}
        <div className="app-header-right">
          {rightActions}
        </div>
      </div>
    </header>
  );
};
