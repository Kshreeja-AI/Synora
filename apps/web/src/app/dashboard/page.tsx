'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@synora/design-system';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
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
      } catch (error) {
        localStorage.removeItem('token');
        window.location.href = '/auth/login';
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <h1 className="text-4xl font-bold mb-2">Welcome, {user?.name || user?.email}!</h1>
      <p className="text-gray-600 mb-8">Start creating amazing content with Synora AI.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">🎨 Image Generation</h2>
          <p className="text-gray-600 mb-4">Generate stunning images from text descriptions.</p>
          <Link href="/dashboard/create?type=image">
            <Button variant="primary">Create Image</Button>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">🎬 Video Generation</h2>
          <p className="text-gray-600 mb-4">Generate videos from prompts and scripts.</p>
          <Link href="/dashboard/create?type=video">
            <Button variant="primary">Create Video</Button>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">✍️ Document Writing</h2>
          <p className="text-gray-600 mb-4">Write and edit documents with AI assistance.</p>
          <Link href="/dashboard/create?type=document">
            <Button variant="primary">Write Document</Button>
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">💻 Code Generation</h2>
          <p className="text-gray-600 mb-4">Generate and optimize code with AI.</p>
          <Link href="/dashboard/create?type=code">
            <Button variant="primary">Generate Code</Button>
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Recent Projects</h2>
        <p className="text-gray-600">No projects yet. Create your first project to get started!</p>
      </div>
    </div>
  );
}
