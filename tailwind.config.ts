import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F7FB",
        ink: {
          50: "#F4F5F9",
          100: "#E7E9F2",
          200: "#CBD0E0",
          300: "#A5ADC6",
          400: "#757FA2",
          500: "#525C7D",
          600: "#3A4260",
          700: "#272D45",
          800: "#191D2E",
          900: "#0E1120",
        },
        brand: {
          50: "#EEF0FF",
          100: "#DEE1FF",
          200: "#C3C7FF",
          300: "#A0A5FF",
          400: "#7C7CF8",
          500: "#5B5BD6",
          600: "#4A46C4",
          700: "#3C38A3",
          800: "#312F82",
          900: "#2A2A67",
        },
        accent: {
          50: "#ECFDF7",
          100: "#D1FAE9",
          200: "#A7F3D6",
          300: "#6EE7BE",
          400: "#34D3A3",
          500: "#10B981",
          600: "#059669",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 19, 34, 0.04), 0 8px 24px -12px rgba(16, 19, 34, 0.12)",
        lift: "0 2px 4px rgba(16, 19, 34, 0.04), 0 18px 40px -20px rgba(16, 19, 34, 0.25)",
        ring: "0 0 0 1px rgba(16, 19, 34, 0.06)",
      },
      borderRadius: {
        xl2: "1.125rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.3s ease-out both",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(91,91,214,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(91,91,214,0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
    },
  },
  plugins: [],
};

export default config;
