import React from "react";

export type IconName =
  | "shield"
  | "alert"
  | "info"
  | "check"
  | "danger"
  | "flag"
  | "coins"
  | "key"
  | "bot"
  | "receipt"
  | "hash"
  | "link"
  | "wallet"
  | "send"
  | "scan"
  | "shield-alert"
  | "theme";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  className?: string;
  size?: number | string;
}

export default function Icon({ name, className = "", size, ...props }: IconProps) {
  return (
    <svg
      className={`icon icon-${name} ${className}`}
      aria-hidden="true"
      style={size ? { width: size, height: size } : undefined}
      {...props}
    >
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  );
}
