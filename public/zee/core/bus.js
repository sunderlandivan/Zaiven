/** @type {Map<string, Set<Function>>} */
const topics = new Map();

export const bus = {
  /**
   * @param {string} topic
   * @param {Function} fn
   */
  on(topic, fn) {
    if (!topics.has(topic)) topics.set(topic, new Set());
    topics.get(topic).add(fn);
    return () => bus.off(topic, fn);
  },
  /**
   * @param {string} topic
   * @param {Function} fn
   */
  off(topic, fn) {
    topics.get(topic)?.delete(fn);
  },
  /**
   * @param {string} topic
   * @param {unknown} [payload]
   */
  emit(topic, payload) {
    const set = topics.get(topic);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (e) {
        console.warn("[zee bus]", topic, e);
      }
    }
  },
};
