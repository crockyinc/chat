/** @type {import('tailwindcss').Config} */
export default {
  content: ['./public/index.html', './client/**/*.{js,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        // Messenger-inspired blue palette
        brand: {
          50: '#eaf4ff',
          100: '#d3e8ff',
          200: '#a9d1ff',
          300: '#7ab8ff',
          400: '#4a9cf5',
          500: '#0a84ff',
          600: '#0064e0',
          700: '#0050b3',
          800: '#003d8a',
          900: '#012c61',
        },
        bubble: {
          in: '#f0f2f5',
          out: '#0a84ff',
        },
      },
      boxShadow: {
        bubble: '0 1px 2px rgba(0,0,0,.08)',
        panel: '0 8px 30px rgba(16, 24, 40, .12)',
      },
      maxWidth: {
        bubble: 'min(68ch, 78%)',
      },
    },
  },
  plugins: [],
};
