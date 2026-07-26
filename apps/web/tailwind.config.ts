import type { Config } from 'tailwindcss';
import preset from '@synora/design-system/tailwind-preset';

const config: Config = {
  presets: [preset as Config],
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/design-system/src/**/*.{js,ts,jsx,tsx}',
  ],
};

export default config;
