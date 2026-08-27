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
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shieldLogoSvg"
      >
        <defs>
          <linearGradient id="shieldBaseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2e72ff" />
            <stop offset="50%" stopColor="#0052ff" />
            <stop offset="100%" stopColor="#0035b8" />
          </linearGradient>
          <linearGradient id="shieldCoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <linearGradient id="shieldCyanGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0052ff" />
          </linearGradient>
          <filter id="logoGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Shield Shell */}
        <path
          d="M50 8L86 22V52C86 74 69 91 50 96C31 91 14 74 14 52V22L50 8Z"
          fill="url(#shieldBaseGrad)"
          stroke="#3b82f6"
          strokeWidth="2.5"
          filter="url(#logoGlow)"
        />

        {/* Inner Geometric Shield Facet */}
        <path
          d="M50 18L76 29V50C76 67 64 80 50 85C36 80 24 67 24 50V29L50 18Z"
          fill="#0a1226"
          fillOpacity="0.85"
          stroke="rgba(255, 255, 255, 0.15)"
          strokeWidth="1.5"
        />

        {/* Base Iconic Blue Node Circle */}
        <circle cx="50" cy="50" r="14" fill="url(#shieldCyanGlow)" />
        <circle cx="50" cy="50" r="8" fill="#ffffff" />
        <circle cx="50" cy="50" r="4" fill="#0052ff" />

        {/* Cyber Apex Node Accent */}
        <path
          d="M50 24L56 32H44L50 24Z"
          fill="#38bdf8"
          opacity="0.9"
        />
      </svg>
    </div>
  );
}
