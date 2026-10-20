// POST /api/wines/rank-by-favorites { slugs: string[], favorites: string[] } -> { items: [{ slug, match, reasons, like }] }
// Shelf photo where none of the user's favourites stands: rank the recognised shelf wines by how close they are to the favourites.
import { rankByFavorites } from '../../utils/analogs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slugs?: string[], favorites?: string[] }>(event)
  const slugs = (body?.slugs || []).filter(s => typeof s === 'string').slice(0, 64)
  const favorites = (body?.favorites || []).filter(s => typeof s === 'string').slice(0, 200)
  if (!slugs.length || !favorites.length) return { items: [] }
  return { items: await rankByFavorites(slugs, favorites) }
})
