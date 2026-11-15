import type { HTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

/* --- Panel --- */
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  code?: string;
  actions?: ReactNode;
  vellum?: boolean;
  chamfer?: boolean;
  children: ReactNode;
}

export function Panel({
  title,
  code,
  actions,
  vellum = false,
  chamfer = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const classes = [
    styles.panel,
    vellum ? styles.panelVellum : "",
    chamfer ? styles.panelChamfer : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} {...rest}>
      {title || code || actions ? (
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleGroup}>
            {code ? <span className={styles.panelCode}>{code}</span> : null}
            {title ? <h3 className={styles.panelTitle}>{title}</h3> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </header>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

/* --- Divider --- */
export interface DividerProps {
  label?: string;
  ticks?: boolean;
}

export function Divider({ label, ticks = true }: DividerProps) {
  return (
    <div
      role="separator"
      className={[styles.divider, ticks ? styles.dividerTicks : ""].filter(Boolean).join(" ")}
    >
      <span className={styles.dividerLine} />
      {label ? <span className={styles.dividerLabel}>{label}</span> : null}
      {label ? <span className={styles.dividerLine} /> : null}
    </div>
  );
}

/* --- Badge --- */
export type BadgeVariant =
  | "neutral"
  | "teal"
  | "vermilion"
  | "safe"
  | "hazard"
  | "caution"
  | "building";

export interface BadgeProps {
  variant?: BadgeVariant;
  numeric?: boolean;
  children: ReactNode;
  className?: string;
}

const BADGE_CLASS: Record<BadgeVariant, string> = {
  neutral: styles.badgeNeutral,
  teal: styles.badgeTeal,
  vermilion: styles.badgeVermilion,
  safe: styles.badgeSafe,
  hazard: styles.badgeHazard,
  caution: styles.badgeCaution,
  building: styles.badgeBuilding,
};

export function Badge({
  variant = "neutral",
  numeric = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={[
        styles.badge,
        BADGE_CLASS[variant],
        numeric && variant !== "building" ? styles.badgeNumeric : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

/* --- ListRow --- */
export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  selected = false,
  onClick,
}: ListRowProps) {
  const classes = [
    styles.listRow,
    onClick ? styles.listRowInteractive : "",
    selected ? styles.listRowSelected : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        <div className={styles.listRowLeft}>
          {leading}
          <div className={styles.listRowBody}>
            <span className={styles.listRowTitle}>{title}</span>
            {subtitle ? <span className={styles.listRowSubtitle}>{subtitle}</span> : null}
          </div>
        </div>
        {trailing ? <div className={styles.listRowRight}>{trailing}</div> : null}
      </button>
    );
  }

  return (
    <div className={classes}>
      <div className={styles.listRowLeft}>
        {leading}
        <div className={styles.listRowBody}>
          <span className={styles.listRowTitle}>{title}</span>
          {subtitle ? <span className={styles.listRowSubtitle}>{subtitle}</span> : null}
        </div>
      </div>
      {trailing ? <div className={styles.listRowRight}>{trailing}</div> : null}
    </div>
  );
}
