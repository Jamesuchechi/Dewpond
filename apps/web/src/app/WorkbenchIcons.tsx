import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function DewpondLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#13233C" />
      <path
        d="M6.5 18.25C6.5 23.1 10.6 26 16 26C21.4 26 25.5 23.1 25.5 18.25H6.5Z"
        fill="#1D4ED8"
      />
      <path d="M8.5 13.75H23.5L21.5 17.5H10.5L8.5 13.75Z" fill="#38BDF8" />
      <circle cx="22.5" cy="8.75" r="2.75" fill="#D97706" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 13V4.5" strokeLinecap="round" />
      <path d="M6.5 8L10 4.5L13.5 8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4 13.5V15.5C4 16.05 4.45 16.5 5 16.5H15C15.55 16.5 16 16.05 16 15.5V13.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconTable(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8.5H17M8.5 8.5V16" />
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

export function IconPlay(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M6.25 4.75L15.25 10L6.25 15.25V4.75Z" />
    </svg>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 6.5L4 10L7.5 13.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4.5 10H12.5C14.7 10 16.25 11.4 16.25 13.5C16.25 14.5 15.8 15.2 15.1 15.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.5 6.5L16 10L12.5 13.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M15.5 10H7.5C5.3 10 3.75 11.4 3.75 13.5C3.75 14.5 4.2 15.2 4.9 15.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 3.75V12.25" strokeLinecap="round" />
      <path d="M6.5 9.25L10 12.75L13.5 9.25" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4 14.25V15.75C4 16.16 4.34 16.5 4.75 16.5H15.25C15.66 16.5 16 16.16 16 15.75V14.25"
        strokeLinecap="round"
      />
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
