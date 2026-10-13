export function mergeSavedPayload(current, submitted, result) {
  return current === submitted ? result : { ...current, version: result.version };
}
