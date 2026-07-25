import Link from 'next/link';
import { Check } from 'lucide-react';
import { Badge, Button, Card, CardContent, cn } from '@synora/design-system';
import type { Plan } from '../../content/plans';

export function PlanCard({ plan }: { plan: Plan }): React.JSX.Element {
  return (
    <Card
      className={cn(
        'relative flex h-full flex-col transition-transform motion-safe:hover:-translate-y-1',
        plan.popular && 'border-primary/60 shadow-lg shadow-primary/10'
      )}
    >
      {plan.popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>
      )}
      <CardContent className="flex flex-1 flex-col p-8">
        <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
        <div className="mt-6 flex items-baseline gap-1">
          <span className="text-4xl font-bold tracking-tight text-foreground">
            ${plan.priceMonthly}
          </span>
          <span className="text-sm text-muted-foreground">/month</span>
        </div>
        {plan.priceMonthly > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            ${plan.priceYearlyPerMonth}/month billed yearly
          </p>
        )}
        <ul className="mt-8 flex-1 space-y-3">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {feature}
            </li>
          ))}
        </ul>
        <Button
          asChild
          variant={plan.popular ? 'primary' : 'outline'}
          size="lg"
          className="mt-8 w-full"
        >
          <Link href="/auth/register">{plan.cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
