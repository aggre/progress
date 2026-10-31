import type { APIRoute } from 'astro';

export const prerender = true;
const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

// eslint-disable-next-line functional/prefer-immutable-types, functional/functional-parameters -- Astro's static route returns a native HTTP response containing the scoped installation manifest.
export const GET: APIRoute = () => new Response(JSON.stringify({
  id: base,
  name: 'Little by little',
  short_name: 'Little by little',
  description: 'Family events and reminders, a little closer every day.',
  start_url: base,
  scope: base,
  display: 'standalone',
  background_color: '#f8f8f2',
  theme_color: '#f8f8f2',
  icons: [{ src: `${base}favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}), { headers: { 'Content-Type': 'application/manifest+json' } });
