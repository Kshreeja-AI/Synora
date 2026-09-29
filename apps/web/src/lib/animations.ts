import { Variants } from 'framer-motion';

/** Animation durations in seconds — natural, not rushed */
export const ANIMATION_DURATIONS = {
  xs: 0.15,
  sm: 0.2,
  md: 0.3,
  lg: 0.5,
  xl: 0.7,
  '2xl': 1,
} as const;

/** Natural easing curves — smooth, not bouncy */
export const EASING = {
  smooth: [0.4, 0, 0.2, 1],
  smoother: [0.25, 0.46, 0.45, 0.94],
  smoothest: [0.33, 0.66, 0.66, 1],
} as const;

/** Reduced motion support — detects prefers-reduced-motion */
export const getReducedMotionVariants = (
  variants: Variants,
  reduceMotion: boolean
): Variants => {
  if (!reduceMotion) return variants;

  const reduced: Variants = {};
  Object.entries(variants).forEach(([key, value]) => {
    if (typeof value === 'function') {
      reduced[key] = ((custom?: unknown) => {
        const result = (value as (custom?: unknown) => unknown)(custom);
        return typeof result === 'object' && result !== null
          ? { ...result, transition: { duration: 0 } }
          : result;
      }) as Variants[string];
    } else if (typeof value === 'object' && value !== null && 'transition' in value) {
      reduced[key] = { ...value, transition: { duration: 0 } };
    } else {
      reduced[key] = value;
    }
  });
  return reduced;
};

// ============================================================================
// HERO REVEAL (initial page load)
// ============================================================================

export const heroHeadlineVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: EASING.smooth },
  },
};

export const heroSubheadlineVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: ANIMATION_DURATIONS.md,
      ease: EASING.smooth,
      delay: ANIMATION_DURATIONS.sm,
    },
  },
};

export const heroCTAVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: ANIMATION_DURATIONS.md,
      ease: EASING.smooth,
      delay: ANIMATION_DURATIONS.md,
    },
  },
};

export const heroStatisticVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: ANIMATION_DURATIONS.md,
      ease: EASING.smooth,
      delay: ANIMATION_DURATIONS.md + index * ANIMATION_DURATIONS.xs,
    },
  }),
};

// ============================================================================
// SECTION REVEAL (scroll into view)
// ============================================================================

export const sectionRevealVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: EASING.smooth },
  },
};

export const sectionHeadingVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

// ============================================================================
// CARD ANIMATIONS
// ============================================================================

export const cardContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs,
      delayChildren: ANIMATION_DURATIONS.xs,
    },
  },
};

export const cardItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

export const cardHoverVariants: Variants = {
  rest: { y: 0, scale: 1 },
  hover: {
    y: -4,
    transition: { duration: ANIMATION_DURATIONS.xs, ease: EASING.smooth },
  },
};

// ============================================================================
// BUTTON & INTERACTION
// ============================================================================

export const buttonVariants: Variants = {
  rest: { scale: 1 },
  hover: {
    scale: 1.02,
    transition: { duration: ANIMATION_DURATIONS.xs, ease: EASING.smooth },
  },
  tap: {
    scale: 0.98,
    transition: { duration: ANIMATION_DURATIONS.xs, ease: EASING.smooth },
  },
};

export const iconButtonVariants: Variants = {
  rest: { rotate: 0 },
  hover: {
    rotate: 6,
    transition: { duration: ANIMATION_DURATIONS.xs, ease: EASING.smooth },
  },
};

// ============================================================================
// TEXT ANIMATIONS
// ============================================================================

export const textContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs * 0.5,
      delayChildren: 0,
    },
  },
};

export const textWordVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.sm, ease: EASING.smooth },
  },
};

// ============================================================================
// LIST ANIMATIONS
// ============================================================================

export const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs,
      delayChildren: 0,
    },
  },
};

export const listItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.sm, ease: EASING.smooth },
  },
};

// ============================================================================
// STATISTICS / METRICS
// ============================================================================

export const statContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs,
      delayChildren: ANIMATION_DURATIONS.xs,
    },
  },
};

export const statItemVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

// ============================================================================
// PRICING PLAN
// ============================================================================

export const pricingContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs * 1.5,
      delayChildren: ANIMATION_DURATIONS.xs,
    },
  },
};

export const pricingPlanVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: EASING.smooth },
  },
};

export const pricingFeatureVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.sm, ease: EASING.smooth },
  },
};

// ============================================================================
// TESTIMONIALS
// ============================================================================

export const testimonialContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs,
      delayChildren: 0,
    },
  },
};

export const testimonialCardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

// ============================================================================
// FAQ & DISCLOSURE
// ============================================================================

export const faqContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: ANIMATION_DURATIONS.xs * 0.75,
      delayChildren: 0,
    },
  },
};

export const faqItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.sm, ease: EASING.smooth },
  },
};

export const expandVariants: Variants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

// ============================================================================
// FOOTER
// ============================================================================

export const footerRevealVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

// ============================================================================
// LEGACY / DEPRECATED VARIANTS (kept for compatibility, but use new ones above)
// ============================================================================

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

export const fadeUpVariants: Variants = heroSubheadlineVariants;

export const fadeDownVariants: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: ANIMATION_DURATIONS.md, ease: EASING.smooth },
  },
};

export const slideInLeftVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: EASING.smooth },
  },
};

export const slideInRightVariants: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: ANIMATION_DURATIONS.lg, ease: EASING.smooth },
  },
};

export const scaleInVariants: Variants = statItemVariants;

export const staggerContainerVariants: Variants = cardContainerVariants;

export const staggerItemVariants: Variants = cardItemVariants;

export const scrollRevealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: ANIMATION_DURATIONS.lg,
      ease: EASING.smooth,
      delay: index ? index * ANIMATION_DURATIONS.xs : 0,
    },
  }),
};

export const containerVariants: Variants = cardContainerVariants;

export const itemVariants: Variants = cardItemVariants;
