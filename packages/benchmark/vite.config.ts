import tailwindcss from "@tailwindcss/vite";

export default {
  plugins: tailwindcss(),
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
};
