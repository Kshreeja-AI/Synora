import { Variants } from 'framer-motion';

export const ANIMATION_DURATIONS = {
  xs: 0.15,
  sm: 0.2,
  md: 0.3,
  lg: 0.5,
  xl: 0.7,
  '2xl': 1,
} as const;

export const EASING = {
  smooth: [0.4, 0, 0.2, 1],
  bounce: [0.68, -0.55, 0.265, 1.55],
  elastic: [0.175, 0.885, 0.32, 1.275],
} as const;

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};

export const fadeDownVariants: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};

export const slideInLeftVariants: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: 'easeOut' },
  },
};

export const slideInRightVariants: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: 'easeOut' },
  },
};

export const scaleInVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};

export const blurInVariants: Variants = {
  hidden: { opacity: 0, filter: 'blur(12px)' },
  visible: {
    opacity: 1,
    filter: 'blur(0px)',
    transition: { duration: ANIMATION_DURATIONS.lg, ease: 'easeOut' },
  },
};

export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.sm,
      delayChildren: 0.1,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};

export const scrollRevealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (custom?: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: ANIMATION_DURATIONS.lg,
      ease: 'easeOut',
      delay: custom ? custom * ANIMATION_DURATIONS.sm : 0,
    },
  }),
};

export const magneticButtonVariants: Variants = {
  rest: { x: 0, y: 0 },
  hover: { x: 2, y: -2 },
  tap: { scale: 0.98 },
};

export const textRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (custom?: number) => ({
    opacity: 1,
    transition: {
      staggerChildren: 0.02,
      delayChildren: custom ? custom * ANIMATION_DURATIONS.sm : 0,
    },
  }),
};

export const textCharVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.sm, ease: 'easeOut' },
  },
};

export const pulseGlowVariants: Variants = {
  animate: {
    boxShadow: [
      '0 0 16px 0 rgb(var(--primary) / 0.15)',
      '0 0 24px 0 rgb(var(--primary) / 0.25)',
      '0 0 16px 0 rgb(var(--primary) / 0.15)',
    ],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

export const floatVariants: Variants = {
  animate: {
    y: [0, -8, 0],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

export const shimmerVariants: Variants = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

export const parallaxVariants = (offset: number): Variants => ({
  visible: (custom?: number) => ({
    y: custom ? custom * offset : 0,
    transition: { duration: 0.3, ease: 'easeOut' },
  }),
});

export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.sm,
      delayChildren: ANIMATION_DURATIONS.md,
    },
  },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: 'easeOut' },
  },
};
