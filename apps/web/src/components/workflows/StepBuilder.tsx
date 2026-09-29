'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@synora/design-system';
import type { PlannedStep } from '@/lib/api/agents';

/**
 * Builds an ordered sequence of steps.
 *
 * TWO DECISIONS WORTH EXPLAINING.
 *
 * Step ids are generated and shown, not typed. A person writing a
 * workflow should be thinking about what happens, not inventing
 * identifiers — but the ids are visible because the run record refers to
 * them ("waiting for your decision on step s2"), and a label the user has
 * never seen is a label they cannot act on.
 *
 * A tool step is read-only ONLY if you say so. The engine treats a step
 * that does not declare itself read-only as one that changes something,
 * which means it pauses for approval under the default policy. The
 * checkbox is therefore phrased as a claim the author is making, not a
 * convenience toggle — because getting it wrong in the permissive
 * direction is how an automation quietly changes data nobody approved.
 */

export function StepBuilder({
  steps,
  onChange,
}: {
  steps: PlannedStep[];
  onChange: (steps: PlannedStep[]) => void;
}) {
  function update(index: number, patch: Partial<PlannedStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function add(kind: PlannedStep['kind']) {
    onChange([
      ...steps,
      {
        id: `s${steps.length + 1}`,
        kind,
        description: kind === 'tool' ? 'Call a tool' : 'Generate text',
        input: '',
        ...(kind === 'tool' ? { toolId: '' } : {}),
      },
    ]);
  }

  /**
   * Removing renumbers the remaining steps. Ids must stay sequential
   * because dependencies are forward-only — a gap would be legal but
   * confusing to read in a run record.
   */
  function remove(index: number) {
    onChange(
      steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, id: `s${i + 1}` })),
    );
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((s, i) => ({ ...s, id: `s${i + 1}` })));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Steps</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => add('generate')}>
            <Plus className="mr-1 h-3 w-3" />
            Text step
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add('tool')}>
            <Plus className="mr-1 h-3 w-3" />
            Tool step
          </Button>
        </div>
      </div>

      {steps.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          A workflow needs at least one step. It will run these in order, every time,
          exactly as written.
        </p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{step.id}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {step.kind === 'tool' ? 'tool' : 'text'}
                </span>
                <input
                  value={step.description}
                  onChange={(e) => update(index, { description: e.target.value })}
                  aria-label={`Description for step ${step.id}`}
                  className="h-8 flex-1 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Move step ${step.id} up`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Move step ${step.id} down`}
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove step ${step.id}`}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {step.kind === 'tool' && (
                <div className="space-y-2">
                  <input
                    value={step.toolId ?? ''}
                    onChange={(e) => update(index, { toolId: e.target.value })}
                    placeholder="tool id"
                    aria-label={`Tool for step ${step.id}`}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={step.mutating === false}
                      onChange={(e) =>
                        update(index, { mutating: e.target.checked ? false : undefined })
                      }
                      className="mt-0.5"
                    />
                    <span>
                      This step only reads — it changes nothing. Leave unchecked if you are
                      not certain: an undeclared step is treated as if it changes something,
                      so it will pause for approval.
                    </span>
                  </label>
                </div>
              )}

              <textarea
                value={step.input}
                onChange={(e) => update(index, { input: e.target.value })}
                rows={2}
                placeholder={step.kind === 'tool' ? 'input sent to the tool' : 'prompt'}
                aria-label={`Input for step ${step.id}`}
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
