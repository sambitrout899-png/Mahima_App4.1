module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Makes Tailwind's own `font-sans` utility (and its Preflight base reset)
        // resolve to the self-hosted Inter font everywhere, instead of silently
        // falling back to a generic system stack wherever `font-sans` is used.
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}



