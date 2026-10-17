/**
 * For every non-direct node reachable from `direct`, the shortest chain of
 * ancestors leading to it (starting at a direct node, excluding the node itself).
 */
export function computeVia(
  direct: Iterable<string>,
  edges: Map<string, string[]>,
): Map<string, string[]> {
  const roots = [...direct];
  const directSet = new Set(roots);
  const via = new Map<string, string[]>();
  // Multi-source BFS: the first path found to a node is a shortest one.
  const queue: Array<[string, string[]]> = roots.map((r) => [r, [r]]);
  for (let i = 0; i < queue.length; i++) {
    const [node, path] = queue[i]!;
    for (const child of edges.get(node) ?? []) {
      if (directSet.has(child) || via.has(child)) continue;
      via.set(child, path);
      queue.push([child, [...path, child]]);
    }
  }
  return via;
}
