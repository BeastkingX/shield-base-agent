import React from "react";

interface ShieldLogoProps {
  className?: string;
  size?: number;
}

export default function ShieldLogo({ className = "", size = 36 }: ShieldLogoProps) {
  return (
    <div
      className={`shieldLogoWrapper ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shieldLogoSvg"
      >
        <defs>
          <linearGradient id="sg_logo" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#1D4ED8" />
          </linearGradient>
        </defs>
        {/* shield body */}
        <path d="M32 4 54 12v18c0 14.5-9.4 24.2-22 30C19.4 54.2 10 44.5 10 30V12L32 4Z" fill="url(#sg_logo)" />
        {/* inner hairline for depth */}
        <path d="M32 8.5 50 15.3v15c0 12.1-7.7 20.3-18 25.2-10.3-4.9-18-13.1-18-25.2v-15L32 8.5Z" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
        {/* evidence beam: diagonal scan */}
        <path d="M14 40 50 22" stroke="#60A5FA" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
        {/* checkmark = verdict */}
        <path d="M22 33.5 29 40.5 43 24.5" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
