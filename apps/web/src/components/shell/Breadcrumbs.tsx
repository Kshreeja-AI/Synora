'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@synora/design-system';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  profile: 'Profile',
  account: 'Account',
  sessions: 'Sessions',
  workspace: 'Workspace',
};

function labelFor(segment: string): string {
  return ROUTE_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs(): React.JSX.Element {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join('/')}`,
    label: labelFor(segment),
  }));

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
