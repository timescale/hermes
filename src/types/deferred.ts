export class Deferred<T> {
  public promise: Promise<T>;

  public resolve!: (value: T | PromiseLike<T>) => void;

  public reject!: (reason?: Error) => void;

  public value?: T;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    }).then((value) => {
      this.value = value;
      return value;
    });
  }

  public wrap(promise: PromiseLike<T> | (() => PromiseLike<T>)): Promise<T> {
    this.resolve(typeof promise === 'function' ? promise() : promise);
    return this.promise;
  }
}
