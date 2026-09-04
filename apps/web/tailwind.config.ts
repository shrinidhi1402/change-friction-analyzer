import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#FF6B35',
          primaryHover: '#E05A2B',
          sand: '#F7C59F',
          coral: '#EF5B5B',
          rose: '#D4A5A5',
          espresso: '#2E282A',
          bg: '#FAF8F5',
          surface: '#FFFFFF',
          surfaceMuted: '#F4F0EA',
          border: '#E6E1D8',
          muted: '#6B6265',
          mutedLight: '#9E9497',
          success: '#2B8A3E',
          successBg: '#EBFBEE',
          successBorder: '#B2F2BB',
          warning: '#FF6B35',
          warningBg: '#FFF4E6',
          warningBorder: '#FFD8A8',
          danger: '#EF5B5B',
          dangerBg: '#FFE3E3',
          dangerBorder: '#FFC9C9',
        },
      },
    },
  },
  plugins: [],
};

export default config;
