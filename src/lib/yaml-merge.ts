import { type Document, isMap, isPair, isScalar, type YAMLMap } from 'yaml';

/**
 * Deep-merge a template YAML Document into a user's YAML Document.
 *
 * Rules:
 * - If a key exists in template but not in user → add it (with any comments from template)
 * - If a key exists in both → keep user's value, recurse into maps
 * - If a key exists in user but not in template → keep it (user customization)
 * - Sequences (arrays) are NOT merged — user's array wins entirely
 * - User values ALWAYS win for scalar values
 */
export function mergeYamlDocuments(userDoc: Document, templateDoc: Document): void {
  const userContents = userDoc.contents;
  const templateContents = templateDoc.contents;

  if (!isMap(userContents) || !isMap(templateContents)) {
    return; // Can only merge maps
  }

  mergeMap(userContents, templateContents);
}

function mergeMap(userMap: YAMLMap, templateMap: YAMLMap): void {
  for (const templateItem of templateMap.items) {
    if (!isPair(templateItem)) continue;

    const key = isScalar(templateItem.key) ? templateItem.key.value : null;
    if (key === null) continue;

    const userItem = userMap.items.find(
      item => isPair(item) && isScalar(item.key) && item.key.value === key
    );

    if (!userItem || !isPair(userItem)) {
      // Key doesn't exist in user — add from template (including comments)
      userMap.add(templateItem.clone());
    } else if (isMap(userItem.value) && isMap(templateItem.value)) {
      // Both are maps — recurse
      mergeMap(userItem.value, templateItem.value);
    }
    // Otherwise: user value wins (scalar or seq), do nothing
  }
}
