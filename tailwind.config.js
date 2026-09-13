/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        island: {
          bg: 'rgba(10, 10, 10, 0.85)',
          border: 'rgba(255, 255, 255, 0.08)',
          recording: '#FF3B30',
          waveform: '#30D158',
          text: '#FFFFFF',
          muted: 'rgba(255, 255, 255, 0.5)',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        island: '20px',
      },
      boxShadow: {
        island: '0 8px 32px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'pulse-recording': 'pulse-recording 1.5s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        'pulse-recording': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
      },
    },
  },
  plugins: [],
}
