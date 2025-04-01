module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      // Define custom colors for consistent theming across the application
      colors: {
        // Primary button background color
        'button-bg': '#6c5ce7',
        // Background color for primary buttons on hover
        'button-hover-bg': '#5b4cdb',
        // Color used for indicating errors or unavailable states
        'error-color': '#e74c3c',
        // Color used for indicating success or available states
        'available-color': '#2ecc71',
        // Color used for indicating a pending or checking state
        'checking-color': '#f39c12',
      },
    },
  },
  plugins: [],
}