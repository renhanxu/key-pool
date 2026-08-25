/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 粉色少女心主题
        pink: {
          50: "#FFF0F5",
          100: "#FFE0EC",
          200: "#FFC2D9",
          300: "#FFA3C2",
          400: "#FF8FAB",
          500: "#FF6B9D",
          600: "#E84A85",
          700: "#C9356A",
        },
        // 马卡龙点缀色
        macaron: {
          mint: "#A8E6CF",
          lavender: "#D5A6E8",
          lemon: "#FFF3A0",
          peach: "#FFD3B6",
          sky: "#B5DEFF",
        },
        cream: "#FFFBF5",
      },
      fontFamily: {
        rounded: ['"Comic Sans MS"', '"Yuanti SC"', '"微软雅黑"', "sans-serif"],
        body: ['"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
      },
      boxShadow: {
        soft: "0 4px 24px 0 rgba(255, 143, 171, 0.15)",
        card: "0 2px 8px 0 rgba(255, 143, 171, 0.1)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      animation: {
        "bounce-soft": "bounce-soft 1s ease-in-out infinite",
        "pulse-pink": "pulse-pink 2s ease-in-out infinite",
      },
      keyframes: {
        "bounce-soft": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "pulse-pink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
    },
  },
  plugins: [],
};
