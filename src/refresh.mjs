// One in-flight request and one replacement: repeated refreshes never build a queue.
export function createRefresh(fetch, accept, fail) {
  let desired, running, again = false, generation = 0;
  async function drain() {
    do {
      again = false;
      const current = desired, version = generation;
      try {
        const result = await fetch(current);
        if (version === generation) accept(result);
      } catch (error) {
        if (version === generation) fail(error);
      }
    } while (again);
  }
  return {
    request(value) {
      if (JSON.stringify(value) !== JSON.stringify(desired)) generation++;
      desired = value;
      again = true;
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    },
  };
}
