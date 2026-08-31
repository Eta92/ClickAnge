/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        green: "#3D4228", // primary color — deeper, more saturated
        sage: "#7A8560", // more vivid sage
        gold: "#E8B94A", // richer gold
        cream: "#FDF8F0",
        rose: "#D96C5A", // punchier rose
        tan: "#D49A3E", // warmer, more saturated tan
      },
    },
  },
  plugins: [],
};
