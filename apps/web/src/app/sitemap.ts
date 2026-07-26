import type { MetadataRoute } from 'next';
import { FEATURES } from '../content/features';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/pricing', '/changelog', '/auth/login', '/auth/register'].map(
    (path) => ({
      url: `${BASE_URL}${path}`,
      lastModified: new Date(),
    })
  );
  const featureRoutes = FEATURES.map((feature) => ({
    url: `${BASE_URL}/features/${feature.slug}`,
    lastModified: new Date(),
  }));
  return [...staticRoutes, ...featureRoutes];
}
