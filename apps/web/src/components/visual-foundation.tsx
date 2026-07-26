import type { CSSProperties, ReactNode } from "react";

type CardAccent = "cinnabar" | "ochre" | "pine";

interface NumberedCardProps {
  accent: CardAccent;
  caption: string;
  children: ReactNode;
  label: string;
  number: string;
}

export function NumberedCard({ accent, caption, children, label, number }: NumberedCardProps) {
  return (
    <article className={`numbered-card numbered-card--${accent}`}>
      <div className="number-band" aria-label={`第 ${number} 组`}>
        <span className="number-band__number">{number}</span>
        <span className="number-band__label">{label}</span>
      </div>
      <div className="numbered-card__content">
        <p className="numbered-card__caption">{caption}</p>
        {children}
      </div>
    </article>
  );
}

interface ColorSwatchProps {
  colorCode: string;
  isLight?: boolean;
  name: string;
  value: string;
}

export function ColorSwatch({ colorCode, isLight = false, name, value }: ColorSwatchProps) {
  const dotClassName = isLight ? "color-swatch__dot color-swatch__dot--light" : "color-swatch__dot";
  const style = { "--swatch-color": value } as CSSProperties;

  return (
    <li className="color-swatch">
      <span
        aria-hidden="true"
        className={dotClassName}
        data-testid={`color-dot-${colorCode}`}
        style={style}
      />
      <span className="color-swatch__name">{name}</span>
    </li>
  );
}

interface FoundationActionProps {
  children: ReactNode;
  href: string;
}

export function FoundationAction({ children, href }: FoundationActionProps) {
  return (
    <a className="foundation-action" href={href}>
      <span>{children}</span>
      <span aria-hidden="true">↓</span>
    </a>
  );
}
