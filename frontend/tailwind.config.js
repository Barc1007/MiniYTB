/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Be Vietnam Pro', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
        surface: { 900: '#0b1120', 800: '#111827', 700: '#1e293b', 600: '#334155' },
      },
      aspectRatio: { video: '16 / 9' },
    },
  },
  plugins: [],
};
