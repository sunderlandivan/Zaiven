import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        seniormind: {
          navy: "#1e3a5f",
          "navy-dark": "#152a45",
          accent: "#2563eb",
          "accent-light": "#3b82f6",
          "accent-dark": "#1d4ed8",
          success: "#16a34a",
          danger: "#dc2626",
          light: "#eff6ff",
        },
      },
      fontSize: {
        "tablet-body": ["3rem", { lineHeight: "1.4" }],
        "tablet-heading": ["4rem", { lineHeight: "1.2" }],
      },
    },
  },
  plugins: [],
};
export default config;
