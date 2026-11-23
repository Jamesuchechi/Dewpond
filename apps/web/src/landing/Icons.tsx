import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function DewpondLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0B1526" />
      <path
        d="M6.5 18.25C6.5 23.1 10.6 26 16 26C21.4 26 25.5 23.1 25.5 18.25H6.5Z"
        fill="#1D4ED8"
      />
      <path d="M8.5 13.75H23.5L21.5 17.5H10.5L8.5 13.75Z" fill="#38BDF8" />
      <circle cx="22.5" cy="8.75" r="2.75" fill="#D97706" />
    </svg>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 2.5L16.25 5V9.7C16.25 13.6 13.6 16.75 10 17.75C6.4 16.75 3.75 13.6 3.75 9.7V5L10 2.5Z" />
      <path d="M7.25 10.2L9.15 12.1L13 8.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.5 10H15.5" strokeLinecap="round" />
      <path d="M11 5.5L15.5 10L11 14.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V6.5C7 4.85 8.35 3.5 10 3.5C11.65 3.5 13 4.85 13 6.5V9" strokeLinecap="round" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <path d="M6.25 8L8.75 10L6.25 12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 12.25H13.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 3L17 17" strokeLinecap="round" />
      <path
        d="M8.4 5.2C8.92 5.07 9.46 5 10 5C14.1 5 17 10 17 10C16.38 11.06 15.54 12.1 14.52 12.96"
        strokeLinecap="round"
      />
      <path
        d="M5.75 7.25C4.2 8.38 3.25 10 3.25 10C3.25 10 6 15 10 15C11.15 15 12.2 14.66 13.12 14.12"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.75 10.5L8.25 14L15.25 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 3.25L17.25 16H2.75L10 3.25Z" strokeLinejoin="round" />
      <path d="M10 8V11.25" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <ellipse cx="10" cy="5.5" rx="6" ry="2.25" />
      <path d="M4 5.5V14.5C4 15.75 6.69 16.75 10 16.75C13.31 16.75 16 15.75 16 14.5V5.5" />
      <path d="M4 10C4 11.25 6.69 12.25 10 12.25C13.31 12.25 16 11.25 16 10" />
    </svg>
  );
}
