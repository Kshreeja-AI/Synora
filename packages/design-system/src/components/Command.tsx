'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogTitle } from './Dialog';

/**
 * Hand-rolled command palette primitives (no `cmdk` dependency — see
 * NEXT_TASK.md: "add cmdk only if hand-rolling proves inadequate"). Keyboard
 * navigation and the "no matches" empty state are driven by scanning real
 * DOM attributes on mount/query-change rather than duplicating item state in
 * React, since items are declared as JSX children rather than a data array.
 */

interface CommandContextValue {
  query: string;
  setQuery: (value: string) => void;
  listRef: React.MutableRefObject<HTMLDivElement | null>;
}

const CommandContext = createContext<CommandContextValue | null>(null);

function useCommandContext(component: string): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Command>`);
  }
  return ctx;
}

const VISIBLE_ITEM_SELECTOR = '[data-command-item="true"]:not([data-hidden="true"])';

function activateItem(list: HTMLDivElement | null, element: Element | null): void {
  if (!list) return;
  list.querySelectorAll('[data-command-item="true"]').forEach((el) => el.removeAttribute('data-active'));
  if (element) {
    element.setAttribute('data-active', 'true');
    (element as HTMLElement).scrollIntoView?.({ block: 'nearest' });
  }
}

const Command = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, children, ...props }, ref) => {
    const [query, setQuery] = useState('');
    const listRef = useRef<HTMLDivElement>(null);

    return (
      <CommandContext.Provider value={{ query, setQuery, listRef }}>
        <div ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden', className)} {...props}>
          {children}
        </div>
      </CommandContext.Provider>
    );
  }
);
Command.displayName = 'Command';

interface CommandDialogProps extends React.ComponentPropsWithoutRef<typeof Dialog> {
  label?: string;
}

function CommandDialog({ children, label = 'Command palette', ...props }: CommandDialogProps): React.JSX.Element {
  return (
    <Dialog {...props}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
  ({ className, onKeyDown, ...props }, ref) => {
    const { query, setQuery, listRef } = useCommandContext('CommandInput');

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      const list = listRef.current;
      if (!list) return;
      const items = Array.from(list.querySelectorAll(VISIBLE_ITEM_SELECTOR));
      if (items.length === 0) return;
      const activeIndex = items.findIndex((item) => item.getAttribute('data-active') === 'true');

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activateItem(list, items[(activeIndex + 1) % items.length]);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activateItem(list, items[(activeIndex - 1 + items.length) % items.length]);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const active = (activeIndex >= 0 ? items[activeIndex] : items[0]) as HTMLElement | undefined;
        active?.click();
      }
    }

    return (
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          className={cn(
            'flex h-12 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
CommandInput.displayName = 'CommandInput';

const CommandList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, children, ...props }, ref) => {
    const { query, listRef } = useCommandContext('CommandList');

    // Re-highlight the first visible match whenever the query (and therefore
    // which items are hidden) changes, including on initial mount.
    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const items = Array.from(list.querySelectorAll(VISIBLE_ITEM_SELECTOR));
      activateItem(list, items[0] ?? null);
    }, [query, listRef]);

    return (
      <div
        ref={(node) => {
          listRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        role="listbox"
        className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CommandList.displayName = 'CommandList';

function CommandEmpty({ className, ...props }: React.ComponentPropsWithoutRef<'div'>): React.JSX.Element | null {
  const { query, listRef } = useCommandContext('CommandEmpty');
  const [hasNoMatches, setHasNoMatches] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    setHasNoMatches(list ? list.querySelectorAll(VISIBLE_ITEM_SELECTOR).length === 0 : false);
  }, [query, listRef]);

  if (!hasNoMatches) return null;

  return <div className={cn('py-6 text-center text-sm text-muted-foreground', className)} {...props} />;
}

function CommandGroup({
  heading,
  className,
  children,
  ...props
}: { heading?: React.ReactNode } & React.ComponentPropsWithoutRef<'div'>): React.JSX.Element | null {
  const { query } = useCommandContext('CommandGroup');
  const normalizedQuery = query.trim().toLowerCase();
  const hasVisibleItem =
    normalizedQuery.length === 0 ||
    React.Children.toArray(children).some((child) => {
      if (!React.isValidElement<{ value?: string }>(child)) return false;
      const value = child.props.value;
      return typeof value === 'string' && value.toLowerCase().includes(normalizedQuery);
    });

  if (!hasVisibleItem) return null;

  return (
    <div className={cn('overflow-hidden p-1 text-foreground', className)} {...props}>
      {heading && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{heading}</div>
      )}
      {children}
    </div>
  );
}

const CommandSeparator = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  )
);
CommandSeparator.displayName = 'CommandSeparator';

interface CommandItemProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'onSelect'> {
  value: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  ({ value, onSelect, disabled, className, children, onClick, onMouseEnter, ...props }, ref) => {
    const { query, listRef } = useCommandContext('CommandItem');
    const matches = query.trim().length === 0 || value.toLowerCase().includes(query.trim().toLowerCase());

    return (
      <div
        ref={ref}
        data-command-item="true"
        data-value={value}
        data-hidden={matches ? undefined : 'true'}
        role="option"
        aria-disabled={disabled || undefined}
        aria-selected={undefined}
        style={matches ? undefined : { display: 'none' }}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          if (!disabled) activateItem(listRef.current, event.currentTarget);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (!disabled) onSelect?.(value);
        }}
        className={cn(
          'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
          'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CommandItem.displayName = 'CommandItem';

function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
