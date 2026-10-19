import { createEmulatorHost } from './host';
import type { ClientMessage } from './protocol';

// The app is type-checked against the DOM lib; declare just the worker surface used here.
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ClientMessage>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const handle = createEmulatorHost((message, transfer = []) => scope.postMessage(message, transfer));
scope.onmessage = (event) => handle(event.data);
