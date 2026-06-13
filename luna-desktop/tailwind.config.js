/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      letterSpacing: {
        "apple-lg": "-0.028em",
        "apple-md": "-0.016em",
        "apple-sm": "-0.008em",
      },
      colors: {
        luna: {
          bg: "rgb(var(--luna-bg) / <alpha-value>)",
          "bg-secondary": "rgb(var(--luna-bg-secondary) / <alpha-value>)",
          "bg-tertiary": "rgb(var(--luna-bg-tertiary) / <alpha-value>)",
          text: "rgb(var(--luna-text) / <alpha-value>)",
          "text-secondary": "rgb(var(--luna-text-secondary) / <alpha-value>)",
          "text-tertiary": "rgb(var(--luna-text-tertiary) / <alpha-value>)",
          border: "rgb(var(--luna-border) / 0.10)",
          "border-secondary": "rgb(var(--luna-border) / 0.15)",
          "border-primary": "rgb(var(--luna-border) / 0.30)",
          accent: "rgb(var(--luna-accent) / <alpha-value>)",
          "accent-light": "rgb(var(--luna-accent-light) / <alpha-value>)",
          green: "rgb(var(--luna-green) / <alpha-value>)",
          red: "rgb(var(--luna-red) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
