'use client';
import { useParams } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { Card } from '@synora/design-system';
import { useSubscription, usePlans, useCreditBalance } from '../../../../hooks/useBilling';
import { EmptyState } from '@synora/design-system';

export default function BillingPage() {
  const params = useParams();
  const workspaceId = typeof params.id === 'string' ? params.id : '';

  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription(workspaceId);
  const { data: plans, isLoading: isLoadingPlans } = usePlans();
  const { data: credits, isLoading: isLoadingCredits } = useCreditBalance(workspaceId);

  if (isLoadingSubscription || isLoadingPlans || isLoadingCredits) {
    return (
      <div className="space-y-6">
        <div className="bg-muted h-40 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-muted h-32 rounded animate-pulse" />
          <div className="bg-muted h-32 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <EmptyState
        title="No subscription"
        description="Start by selecting a plan"
        icon={<CreditCard />}
      />
    );
  }

  const currentPlan = plans?.find((p) => p.id === subscription.planId);

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold">{currentPlan?.name || 'Unknown Plan'}</h2>
            <p className="text-muted-foreground mt-1">
              {subscription.status === 'ACTIVE'
                ? 'Your subscription is active'
                : `Subscription status: ${subscription.status}`}
            </p>
            {subscription.currentPeriodEnd && (
              <p className="text-sm text-muted-foreground mt-2">
                Next billing date:{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">
              ${(currentPlan?.priceCents || 0) / 100}
            </div>
            <div className="text-muted-foreground ">
              per {currentPlan?.interval === 'MONTH' ? 'month' : 'year'}
            </div>
          </div>
        </div>
      </Card>

      {/* Credits Balance */}
      {credits && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Credits Balance</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground ">Available Credits</p>
              <p className="text-3xl font-bold mt-2">{credits.balance.toLocaleString()}</p>
            </div>
            {currentPlan && currentPlan.creditsPerInterval > 0 && (
              <div className="text-right">
                <p className="text-muted-foreground ">Credits per {currentPlan.interval === 'MONTH' ? 'month' : 'year'}</p>
                <p className="text-2xl font-semibold mt-2">{currentPlan.creditsPerInterval.toLocaleString()}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Plan Features */}
      {currentPlan?.features && Object.keys(currentPlan.features).length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Plan Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(currentPlan.features).map(([key, value]) => (
              <div key={key} className="flex items-center space-x-2">
                <span className="text-success ">✓</span>
                <span className="capitalize">
                  {key.replace(/_/g, ' ')}: {String(value)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cancel Subscription */}
      {subscription.status === 'ACTIVE' && (
        <Card className="p-6 border-destructive/30 bg-destructive/10 ">
          <h3 className="text-lg font-semibold text-destructive mb-2">
            Danger Zone
          </h3>
          <p className="text-destructive mb-4">
            Cancel your subscription at the end of your current billing period. You'll lose access to premium features when your period ends.
          </p>
          <button type="button" className="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 transition-colors">
            Cancel Subscription
          </button>
        </Card>
      )}
    </div>
  );
}
