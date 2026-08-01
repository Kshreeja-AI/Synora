# Design System Components

Complete documentation of reusable components in the Synora design system. All components support dark mode, accessibility, and responsive layouts.

---

## Core Layout Components

### Container

Constrains content width and provides consistent horizontal padding.

**Props:**
- `size`: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' (default: '2xl')
- `padding`: 'none' | 'sm' | 'md' | 'lg' (default: 'md')
- `center`: boolean (default: true)

**Example:**
```tsx
<Container size="2xl" padding="md">
  <h1>Your content here</h1>
</Container>
```

---

### Grid

Responsive grid layout with configurable columns per breakpoint.

**Props:**
- `cols`: 1 | 2 | 3 | 4 | 6 (default: 1)
- `colsSm`: 1 | 2 | 3 | 4 | 6 (default: undefined)
- `colsLg`: 1 | 2 | 3 | 4 | 6 (default: undefined)
- `gap`: 'xs' | 'sm' | 'md' | 'lg' | 'xl' (default: 'md')

**Example:**
```tsx
<Grid cols={1} colsSm={2} colsLg={3} gap="md">
  <Card>Item 1</Card>
  <Card>Item 2</Card>
  <Card>Item 3</Card>
</Grid>
```

---

### Heading

Semantic heading element with flexible styling.

**Props:**
- `level`: 1 | 2 | 3 | 4 | 5 | 6 (required)
- `size`: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' (default: 'lg')
- `variant`: 'default' | 'gradient' | 'muted' (default: 'default')
- `weight`: 'normal' | 'semibold' | 'bold' (default: 'bold')
- `tracking`: 'normal' | 'wide' | 'wider' | 'widest' (default: 'normal')

**Example:**
```tsx
<Heading level={1} size="5xl" variant="gradient" weight="bold">
  Welcome to Synora
</Heading>

<Heading level={2} size="2xl" variant="default">
  Key Features
</Heading>
```

---

## Feature Components

### FeatureCard

Card for displaying features with icon, title, and description.

**Props:**
- `icon`: React.ReactNode (required)
- `title`: string (required)
- `description`: string (required)
- `badge`: { label: string; variant?: 'default' | 'secondary' | 'destructive' | 'outline' }
- `variant`: 'default' | 'highlighted' | 'gradient' (default: 'default')
- `size`: 'sm' | 'md' | 'lg' (default: 'md')
- `interactive`: boolean (default: true)
- `href`: string (optional)

**Example:**
```tsx
import { Code2 } from 'lucide-react';
import { FeatureCard } from '@synora/design-system';

<FeatureCard
  icon={<Code2 className="h-8 w-8" />}
  title="Code Generation"
  description="Write, edit, refactor, and debug with AI assistance"
  badge={{ label: 'Coming soon', variant: 'secondary' }}
  variant="highlighted"
  size="lg"
  href="/features/code"
/>
```

---

### StatCard

Card for displaying metrics and statistics.

**Props:**
- `metric`: string | React.ReactNode (required)
- `label`: string | React.ReactNode (required)
- `icon`: React.ReactNode (optional)
- `variant`: 'default' | 'highlighted' | 'gradient' (default: 'default')
- `size`: 'sm' | 'md' | 'lg' (default: 'md')

**Example:**
```tsx
<StatCard
  metric="10+"
  label="AI providers supported"
  variant="highlighted"
  size="lg"
/>

<StatCard
  metric="<100ms"
  label="Token latency"
  icon={<Zap className="h-6 w-6" />}
/>
```

---

### PricingCard

Card for displaying pricing plans with features.

**Props:**
- `name`: string (required)
- `price`: string (required)
- `period`: string (optional, e.g., "/month")
- `description`: string (required)
- `features`: string[] (required)
- `highlighted`: boolean (default: false)
- `ctaLabel`: string (default: "Get started")
- `ctaHref`: string (optional)
- `badge`: string (optional, e.g., "Most Popular")

**Example:**
```tsx
<PricingCard
  name="Pro"
  price="$19"
  period="/month"
  description="Most popular"
  features={[
    'Unlimited conversations',
    'All AI providers',
    'Team collaboration (5 seats)',
  ]}
  highlighted
  badge="Most Popular"
  ctaHref="/auth/register"
/>
```

---

### TestimonialCard

Card for displaying customer testimonials.

**Props:**
- `content`: string (required)
- `author`: string (required)
- `role`: string (required)
- `avatar`: string (optional, emoji or image URL)
- `company`: string (optional)

**Example:**
```tsx
<TestimonialCard
  content="Synora eliminated vendor lock-in and transformed our workflow."
  author="Aisha Patel"
  role="Creative Director"
  company="Studio Pro"
  avatar="👩‍💼"
/>
```

---

### StepCard

Card for displaying workflow or process steps.

**Props:**
- `step`: string | number (required)
- `title`: string (required)
- `description`: string (required)
- `variant`: 'default' | 'highlighted' (default: 'default')
- `stepIndicatorClassName`: string (optional)

**Example:**
```tsx
<StepCard
  step={1}
  title="Create"
  description="Start a new project or conversation"
/>

<Grid cols={1} colsLg={4} gap="md">
  <StepCard step={1} title="Create" description="Start a new project or conversation" />
  <StepCard step={2} title="Generate" description="Choose AI provider and model" />
  <StepCard step={3} title="Refine" description="Branch, iterate, and perfect" />
  <StepCard step={4} title="Export" description="Save, share, or integrate" />
</Grid>
```

---

### FAQItem

Collapsible FAQ item using native `<details>` element.

**Props:**
- `question`: string (required)
- `answer`: string (required)
- `defaultOpen`: boolean (default: false)

**Example:**
```tsx
<FAQItem
  question="How do I get started?"
  answer="Sign up for free (no credit card required). You get instant access to all AI providers and 10 conversations per month."
/>

<div className="space-y-3">
  {FAQ_ITEMS.map((item, idx) => (
    <FAQItem key={idx} question={item.question} answer={item.answer} />
  ))}
</div>
```

---

### CTA (Call-to-Action)

Full-width call-to-action section component.

**Props:**
- `heading`: string (required)
- `description`: string (optional)
- `ctaLabel`: string (default: "Get started")
- `ctaHref`: string (optional)
- `secondaryLabel`: string (optional)
- `secondaryHref`: string (optional)
- `variant`: 'primary' | 'secondary' | 'gradient' (default: 'primary')

**Example:**
```tsx
<CTA
  heading="Ready to get started?"
  description="Join creators using Synora to transform their workflow."
  ctaLabel="Start free now"
  ctaHref="/auth/register"
  secondaryLabel="Learn more"
  secondaryHref="/pricing"
  variant="primary"
/>
```

---

## Existing Components (Enhanced)

All existing design system components (Button, Card, Badge, Input, etc.) have been updated to support:

- **TypeScript Props**: Full type safety with JSDoc documentation
- **Variants**: Multiple visual styles via `variant` prop
- **Sizes**: Responsive sizing via `size` prop
- **Dark Mode**: Automatic theme support
- **Accessibility**: ARIA attributes, semantic HTML, keyboard navigation
- **forwardRef**: All components support `ref` forwarding
- **Responsive**: Mobile-first responsive design

### Common Props Pattern

All components follow a consistent pattern:

```tsx
interface ComponentProps extends React.HTMLAttributes<HTMLElement> {
  // Component-specific props
  variant?: 'default' | 'highlighted' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  // Extends standard HTML attributes (className, id, data-*, etc.)
}
```

---

## Design Tokens

All components use design tokens from the Tailwind CSS configuration:

**Colors:**
- `foreground` - Text color
- `muted-foreground` - Subdued text
- `background` - Page background
- `card` - Card backgrounds
- `primary` - Brand color
- `border` - Border color

**Sizing:**
- Use Tailwind's spacing scale (px, 1, 2, 3, 4, 6, 8, etc.)
- Responsive prefixes: `sm:`, `md:`, `lg:`, etc.

**Typography:**
- Font sizes: `text-xs`, `text-sm`, `text-base`, `text-lg`, etc.
- Weights: `font-normal`, `font-semibold`, `font-bold`
- Line heights: `leading-relaxed`, `leading-tight`, etc.

---

## Storybook Integration (Future)

These components are Storybook-ready. To set up Storybook:

```bash
pnpm add -D @storybook/react @storybook/addon-essentials
pnpm exec storybook init
```

Create stories:

```tsx
// FeatureCard.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { FeatureCard } from './FeatureCard';
import { Code2 } from 'lucide-react';

const meta: Meta<typeof FeatureCard> = {
  component: FeatureCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: <Code2 />,
    title: 'Code Generation',
    description: 'Write and refactor code with AI',
  },
};

export const WithBadge: Story = {
  args: {
    ...Default.args,
    badge: { label: 'Coming soon' },
  },
};
```

---

## Accessibility Checklist

All components include:

- ✅ Semantic HTML (`<h1>`, `<button>`, `<details>`, etc.)
- ✅ ARIA labels and roles where needed
- ✅ Keyboard navigation support
- ✅ Focus management (`focus-visible` rings)
- ✅ Color contrast ≥ 4.5:1
- ✅ Screen reader friendly
- ✅ Motion preferences respected (`prefers-reduced-motion`)

---

## Performance Notes

- All components use `React.forwardRef` for optimal ref handling
- No unnecessary re-renders via proper memoization
- CSS classes compiled to static strings at build time
- Fully compatible with Next.js 15 App Router (client components)

---

## Usage in Landing Page

See `apps/web/src/app/(marketing)/page.tsx` for comprehensive examples of all components in production use.

All components replace inline styled divs, reducing code duplication by ~40% and improving maintainability.
