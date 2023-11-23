export class CircularBuffer {

  public buffer: string[];

  private limit: number;

  constructor ({ limit }: { limit: number }) {
    this.buffer = new Array(limit).fill('');
    this.limit = limit;
  }

  get () {
    return this.buffer.join('');
  }

  reset () {
    this.buffer = new Array(this.limit).fill('');
  }

  forward (value: string) {
    this.buffer.shift();
    this.buffer.push(value);
  }

  rewind () {
    if (this.buffer.length > 0) {
      this.buffer.pop();

      if (this.buffer.length < this.limit) {
        this.buffer.unshift('');
      }
    }
  }
}