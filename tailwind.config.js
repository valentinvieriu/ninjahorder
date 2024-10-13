module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'button-bg': '#6c5ce7',
        'button-hover-bg': '#5b4cdb',
        'error-color': '#e74c3c',
        'available-color': '#2ecc71',
        'checking-color': '#f39c12',
      },
      keyframes: {
        gradientAnimation: {
          '0%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
          '100%': { 'background-position': '0% 50%' },
        },
      },
      animation: {
        gradientAnimation: 'gradientAnimation 15s ease infinite',
      },
    },
  },
  plugins: [],
}