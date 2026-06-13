"use client";

import type { ReactNode } from "react";

interface BigButtonProps {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "danger" | "success";
  disabled?: boolean;
}

const variantStyles = {
  primary: "bg-seniormind-accent text-white hover:bg-seniormind-accent-light active:bg-seniormind-accent-dark",
  secondary: "bg-white text-seniormind-navy border-4 border-seniormind-navy hover:bg-seniormind-light",
  danger: "bg-seniormind-danger text-white hover:opacity-90",
  success: "bg-seniormind-success text-white hover:opacity-90",
};

export default function BigButton({
  label,
  icon,
  onClick,
  href,
  variant = "primary",
  disabled = false,
}: BigButtonProps) {
  const className = `
    flex items-center justify-center gap-4
    w-full min-h-[120px] px-8 py-6
    text-[2rem] font-bold leading-tight
    rounded-2xl shadow-lg
    transition-all duration-150
    touch-manipulation select-none
    disabled:opacity-50 disabled:cursor-not-allowed
    ${variantStyles[variant]}
  `;

  const content = (
    <>
      {icon && <span className="text-5xl shrink-0">{icon}</span>}
      <span>{label}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}
