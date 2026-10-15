package app.phlip.server

/**
 * Reorder [items] so the given ids appear in [orderedIds] order, without
 * moving anything else. Unknown ids are ignored. Used so an admin who cannot
 * see every private channel still permutes only the rows they can see.
 *
 * Returns true when the list actually changed.
 */
internal fun <T> applyListOrderByIds(
    items: MutableList<T>,
    orderedIds: List<String>,
    idOf: (T) -> String,
): Boolean {
    val wanted = ArrayList<String>(orderedIds.size)
    val seen = HashSet<String>()
    for (raw in orderedIds) {
        val id = raw.trim()
        if (id.isEmpty() || !seen.add(id)) continue
        wanted.add(id)
    }
    if (wanted.size < 2) return false
    val indexById = HashMap<String, Int>(items.size)
    for (i in items.indices) {
        val id = idOf(items[i])
        if (id.isNotEmpty()) indexById.putIfAbsent(id, i)
    }
    val known = wanted.filter { it in indexById }
    if (known.size < 2) return false
    val slots = known.map { indexById.getValue(it) }.sorted()
    val ordered = known.map { items[indexById.getValue(it)] }
    var changed = false
    for (i in slots.indices) {
        if (idOf(items[slots[i]]) != idOf(ordered[i])) {
            changed = true
            break
        }
    }
    if (!changed) return false
    for (i in slots.indices) items[slots[i]] = ordered[i]
    return true
}
