/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F8F5EE",
        ink: "#1C1A17",
        accent: "#1E3A5F",
        hairline: "#E5DFD2",
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Geist"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
