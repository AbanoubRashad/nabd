import type { MetadataRoute } from 'next';
import { PRODUCTS } from '@nabd/shared';
import { SITE_URL } from '@/lib/site';

/** Public marketing pages in both languages. The live dashboard is linked but not listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['', '/products', ...PRODUCTS.map((p) => `/products/${p.code.toLowerCase()}`)];
  return paths.map((path) => ({
    url: `${SITE_URL}${path || '/'}`,
    changeFrequency: path ? 'monthly' : 'weekly',
    priority: path ? 0.6 : 1,
    alternates: { languages: { en: `${SITE_URL}${path || '/'}`, ar: `${SITE_URL}/ar${path}` } },
  }));
}
