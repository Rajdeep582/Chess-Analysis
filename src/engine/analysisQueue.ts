/** Priority queue of pending analysis jobs. Lower priority number runs first; FIFO within a priority. */
export interface QueueItem<T> {
  id: number;
  priority: number;
  group: string;
  payload: T;
  seq: number;
}

export class AnalysisQueue<T> {
  private items: QueueItem<T>[] = [];
  private seq = 0;

  enqueue(id: number, payload: T, priority = 1, group = 'default'): void {
    this.items.push({ id, payload, priority, group, seq: this.seq++ });
    this.items.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  }

  next(): QueueItem<T> | undefined {
    return this.items.shift();
  }

  peek(): QueueItem<T> | undefined {
    return this.items[0];
  }

  remove(id: number): QueueItem<T> | undefined {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  /** Removes all items of a group (e.g. obsolete interactive requests). */
  clearGroup(group: string): QueueItem<T>[] {
    const removed = this.items.filter((i) => i.group === group);
    this.items = this.items.filter((i) => i.group !== group);
    return removed;
  }

  clear(): QueueItem<T>[] {
    const all = this.items;
    this.items = [];
    return all;
  }

  get size(): number {
    return this.items.length;
  }

  list(): readonly QueueItem<T>[] {
    return this.items;
  }
}
