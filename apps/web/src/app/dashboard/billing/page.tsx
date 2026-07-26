'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Badge } from '@synora/design-system';
import { usePlans, useSubscription, useChangePlan } from '../../../hooks/useBilling';
import { EmptyState } from '@synora/design-system';

export default function BillingPlansPage() {
  const params = useParams();
  const workspaceId = typeof params.id === 'string' ? params.id : '';
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const { data: plans, isLoading: isLoadingPlans } = usePlans();
  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription(workspaceId);
  const changePlanMutation = useChangePlan(workspaceId);

  if (isLoadingPlans || isLoadingSubscription) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-200 dark:bg-gray-700 h-96 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <EmptyState
        title="No plans available"
        description="Plans are not yet configured"
        icon="Package"
      />
    );
  }

  const activePlans = plans.filter((p) => p.status === 'ACTIVE');

  const handleSelectPlan = (planId: string) => {
    if (subscription?.planId === planId) {
      return; // Already on this plan
    }
    setSelectedPlanId(planId);
  };

  const handleChangePlan = async (planId: string) => {
    changePlanMutation.mutate(
      { planId },
      {
        onSuccess: () => {
          setSelectedPlanId(null);
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing Plans</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Choose the plan that best fits your needs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {activePlans.map((plan) => {
          const isCurrentPlan = subscription?.planId === plan.id;
          const isSelected = selectedPlanId === plan.id;

          return (
            <Card
              key={plan.id}
              className={`p-6 transition-all ${
                isCurrentPlan
                  ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'hover:shadow-lg'
              }`}
            >
              {/* Plan Header */}
              <div className="mb-6">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-xl font-bold">{plan.name}</h3>
                  {isCurrentPlan && (
                    <Badge variant="success" className="text-xs">
                      Current
                    </Badge>
                  )}
                </div>
                {plan.trialDays && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {plan.trialDays} day free trial
                  </p>
                )}
              </div>

              {/* Pricing */}
              <div className="mb-6">
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold">
                    ${(plan.priceCents / 100).toFixed(2)}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400 ml-2">
                    /{plan.interval === 'MONTH' ? 'month' : 'year'}
                  </span>
                </div>
              </div>

              {/* Credits */}
              {plan.creditsPerInterval > 0 && (
                <div className="mb-6 pb-6 border-b dark:border-gray-700">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {plan.creditsPerInterval.toLocaleString()} credits per{' '}
                    {plan.interval === 'MONTH' ? 'month' : 'year'}
                  </p>
                </div>
              )}

              {/* Features */}
              {plan.features && Object.keys(plan.features).length > 0 && (
                <div className="mb-6">
                  <h4 className="font-semibold text-sm mb-3">Included:</h4>
                  <ul className="space-y-2">
                    {Object.entries(plan.features).map(([key, value]) => (
                      <li key={key} className="flex items-center text-sm">
                        <span className="text-green-600 dark:text-green-400 mr-2">✓</span>
                        <span className="capitalize">
                          {key.replace(/_/g, ' ')}: {String(value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Button */}
              {isCurrentPlan ? (
                <button
                  disabled
                  className="w-full py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded font-medium cursor-not-allowed"
                >
                  Current Plan
                </button>
              ) : (
                <>
                  {isSelected ? (
                    <button
                      onClick={() => handleChangePlan(plan.id)}
                      disabled={changePlanMutation.isPending}
                      className="w-full py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {changePlanMutation.isPending ? 'Changing...' : 'Confirm'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSelectPlan(plan.id)}
                      className="w-full py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
                    >
                      Select Plan
                    </button>
                  )}
                </>
              )}

              {isSelected && (
                <button
                  onClick={() => setSelectedPlanId(null)}
                  className="w-full mt-2 py-2 text-gray-600 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Cancel
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
