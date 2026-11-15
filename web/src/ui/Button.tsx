import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  chamfer?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  quiet: styles.buttonQuiet,
  danger: styles.buttonDanger,
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: styles.buttonSm,
  md: styles.buttonMd,
  lg: styles.buttonLg,
};

export function Button({
  variant = "secondary",
  size = "md",
  chamfer = false,
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    chamfer ? styles.buttonChamfer : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "aria-label": string;
}

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: styles.iconButtonSm,
  md: styles.iconButtonMd,
  lg: styles.iconButtonLg,
};

export function IconButton({
  variant = "secondary",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    styles.iconButton,
    VARIANT_CLASS[variant],
    ICON_SIZE_CLASS[size],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
