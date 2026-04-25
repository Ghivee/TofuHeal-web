/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-green': {
          light: '#f0fdf4',
          DEFAULT: '#10b981',
          dark: '#065f46',
        },
        'medical-status': {
          nominal: '#10b981',
          warning: '#facc15',
          critical: '#ef4444',
        }
      }
    },
  },
  plugins: [],
}
