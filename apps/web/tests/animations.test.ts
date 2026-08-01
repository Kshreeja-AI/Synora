import { describe, it, expect } from 'vitest';
import {
  ANIMATION_DURATIONS,
  EASING,
  fadeInVariants,
  fadeUpVariants,
  staggerContainerVariants,
  staggerItemVariants,
  scrollRevealVariants,
  buttonVariants,
  containerVariants,
  itemVariants,
} from '../src/lib/animations';

describe('Animation System', () => {
  describe('Animation Durations', () => {
    it('defines all animation duration tiers', () => {
      expect(ANIMATION_DURATIONS.xs).toBe(0.15);
      expect(ANIMATION_DURATIONS.sm).toBe(0.2);
      expect(ANIMATION_DURATIONS.md).toBe(0.3);
      expect(ANIMATION_DURATIONS.lg).toBe(0.5);
      expect(ANIMATION_DURATIONS.xl).toBe(0.7);
      expect(ANIMATION_DURATIONS['2xl']).toBe(1);
    });

    it('all durations are positive numbers', () => {
      Object.values(ANIMATION_DURATIONS).forEach((duration) => {
        expect(duration).toBeGreaterThan(0);
      });
    });
  });

  describe('Easing Functions', () => {
    it('defines smooth easing variants', () => {
      expect(EASING.smooth).toBeDefined();
      expect(EASING.smoother).toBeDefined();
      expect(EASING.smoothest).toBeDefined();
    });

    it('easing functions are arrays of 4 numbers', () => {
      Object.values(EASING).forEach((easing) => {
        expect(Array.isArray(easing)).toBe(true);
        expect(easing).toHaveLength(4);
        easing.forEach((value) => {
          expect(typeof value).toBe('number');
        });
      });
    });
  });

  describe('Fade Variants', () => {
    it('fadeInVariants has hidden and visible states', () => {
      expect(fadeInVariants.hidden).toBeDefined();
      expect(fadeInVariants.visible).toBeDefined();
    });

    it('fadeUpVariants includes transform and opacity', () => {
      expect(fadeUpVariants.hidden).toEqual({ opacity: 0, y: 12 });
      expect(fadeUpVariants.visible).toBeDefined();
    });
  });

  describe('Stagger Variants', () => {
    it('staggerContainerVariants defines stagger timing', () => {
      expect(staggerContainerVariants.hidden).toBeDefined();
      expect(staggerContainerVariants.visible).toBeDefined();
      const visible = staggerContainerVariants.visible as any;
      expect(visible.transition.staggerChildren).toBeDefined();
      expect(visible.transition.delayChildren).toBeDefined();
    });

    it('staggerItemVariants animates individual items', () => {
      expect(staggerItemVariants.hidden).toBeDefined();
      expect(staggerItemVariants.visible).toBeDefined();
    });
  });

  describe('Interactive Variants', () => {
    it('buttonVariants has rest, hover, and tap states', () => {
      expect(buttonVariants.rest).toBeDefined();
      expect(buttonVariants.hover).toBeDefined();
      expect(buttonVariants.tap).toBeDefined();
    });

    it('buttonVariants produces scale transformations on hover', () => {
      const hover = buttonVariants.hover as any;
      expect(hover.scale).toBeDefined();
    });
  });

  describe('Container and Item Variants', () => {
    it('containerVariants supports staggered children', () => {
      expect(containerVariants.hidden).toBeDefined();
      expect(containerVariants.visible).toBeDefined();
      const visible = containerVariants.visible as any;
      expect(visible.transition.staggerChildren).toBeGreaterThan(0);
    });

    it('itemVariants animates individual items with fade-up', () => {
      expect(itemVariants.hidden).toBeDefined();
      const hidden = itemVariants.hidden as any;
      expect(hidden.opacity).toBe(0);
      expect(hidden.y).toBe(12); // Now uses cardItemVariants which has y: 12
    });
  });

  describe('Scroll Reveal Variants', () => {
    it('scrollRevealVariants supports custom delay via custom parameter', () => {
      const visible = scrollRevealVariants.visible as any;
      expect(typeof visible).toBe('function');
    });
  });

  describe('All Variants Export', () => {
    it('exports all variant objects', () => {
      expect(fadeInVariants).toBeDefined();
      expect(fadeUpVariants).toBeDefined();
      expect(staggerContainerVariants).toBeDefined();
      expect(staggerItemVariants).toBeDefined();
      expect(scrollRevealVariants).toBeDefined();
      expect(buttonVariants).toBeDefined();
      expect(containerVariants).toBeDefined();
      expect(itemVariants).toBeDefined();
    });
  });
});
