'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, Skeleton } from '@synora/design-system';

interface User {
  id: string;
  email: string;
  name?: string;
}

const createActions = [
  {
    icon: '🎨',
    title: 'Image Generation',
    description: 'Generate stunning images from text descriptions.',
    href: '/dashboard/create?type=image',
    cta: 'Create Image',
  },
  {
    icon: '🎬',
    title: 'Video Generation',
    description: 'Generate videos from prompts and scripts.',
    href: '/dashboard/create?type=video',
    cta: 'Create Video',
  },
  {
    icon: '✍️',
    title: 'Document Writing',
    description: 'Write and edit documents with AI assistance.',
    href: '/dashboard/create?type=document',
    cta: 'Write Document',
  },
  {
    icon: '💻',
    title: 'Code Generation',
    description: 'Generate and optimize code with AI.',
    href: '/dashboard/create?type=code',
    cta: 'Generate Code',
  },
];

export default function DashboardPage(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async (): Promise<void> => {
      const token = localStorage.getItem('token');
      if (!token) {
        window.location.href = '/auth/login';
        return;
      }

      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch user');
        }

        const data = await response.json();
        setUser(data.data);
      } catch {
        localStorage.removeItem('token');
        window.location.href = '/auth/login';
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-4xl font-bold text-foreground">
        Welcome, {user?.name || user?.email}!
      </h1>
      <p className="mb-8 text-muted-foreground">Start creating amazing content with Synora AI.</p>

      <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {createActions.map((action) => (
          <Card key={action.title}>
            <CardContent className="p-6">
              <h2 className="mb-4 text-2xl font-bold text-foreground">
                {action.icon} {action.title}
              </h2>
              <p className="mb-4 text-muted-foreground">{action.description}</p>
              <Button asChild variant="primary">
                <Link href={action.href}>{action.cta}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-2xl font-bold text-foreground">Recent Projects</h2>
          <p className="text-muted-foreground">
            No projects yet. Create your first project to get started!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
