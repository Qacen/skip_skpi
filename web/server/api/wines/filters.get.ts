// GET /api/wines/filters — filter groups with values and counts
import { filters } from '../../utils/catalog'

export default defineEventHandler(() => filters())
