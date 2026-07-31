import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

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
  compact?: boolean;
  isLight?: boolean;
  name: string;
  value: string;
}

export function ColorSwatch({
  colorCode,
  compact = false,
  isLight = false,
  name,
  value,
}: ColorSwatchProps) {
  const dotClassName = isLight ? "color-swatch__dot color-swatch__dot--light" : "color-swatch__dot";
  const style = { "--swatch-color": value } as CSSProperties;

  return (
    <li className={compact ? "color-swatch color-swatch--compact" : "color-swatch"}>
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
  fullWidth?: boolean;
  href: string;
  indicator?: ReactNode;
}

export function FoundationAction({
  children,
  fullWidth = false,
  href,
  indicator = "↓",
}: FoundationActionProps) {
  const className = fullWidth ? "foundation-action foundation-action--full" : "foundation-action";

  return (
    <a className={className} href={href}>
      <span>{children}</span>
      <span aria-hidden="true">{indicator}</span>
    </a>
  );
}

interface FoundationButtonProps {
  children: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  indicator?: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  tone?: "primary" | "secondary";
}

export function FoundationButton({
  children,
  disabled = false,
  fullWidth = false,
  indicator = "→",
  onClick,
  tone = "primary",
}: FoundationButtonProps) {
  const className = [
    "foundation-action",
    "foundation-action--button",
    fullWidth ? "foundation-action--full" : null,
    tone === "secondary" ? "foundation-action--secondary" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} disabled={disabled} onClick={onClick} type="button">
      <span>{children}</span>
      <span aria-hidden="true">{indicator}</span>
    </button>
  );
}
