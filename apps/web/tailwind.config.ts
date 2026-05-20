import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
        display: ['var(--font-bebas)', 'sans-serif'],
      },
      colors: {
        huma: {
          bg: 'var(--bg)',
          bg2: 'var(--bg2)',
          bg3: 'var(--bg3)',
          bg4: 'var(--bg4)',
          sb: 'var(--sb)',
          acc: 'var(--acc)',
          acc2: 'var(--acc2)',
          t: 'var(--t)',
          t2: 'var(--t2)',
          t3: 'var(--t3)',
          t4: 'var(--t4)',
          bdr: 'var(--bdr)',
          ok: 'var(--ok)',
          warn: 'var(--warn)',
          err: 'var(--err)',
          blue: 'var(--blue)',
        },
      },
      boxShadow: {
        glow: '0 0 24px var(--glow)',
        panel: '0 8px 32px rgba(0,0,0,0.35)',
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        blink: 'blink 1.2s infinite',
        fadeIn: 'fadeIn 0.22s ease',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(5px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
